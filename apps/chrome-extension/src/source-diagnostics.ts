/**
 * Read-only, post-observation spatial hints. A hit-tested element is NOT proof
 * that it generated a previously observed flash. No page content is collected.
 */
import type { Finding } from '@epi-less/core';

export interface DiagnosticContext {
  /** Ephemeral comparison values: never include these in an audit/export. */
  url: string;
  documentToken: string;
  /** Monotonic per-document resize counter; missing means observation unavailable. */
  viewportRevision?: number;
  viewport: {
    width: number;
    height: number;
    dpr: number;
    scrollX: number;
    scrollY: number;
    visualScale: number;
    visualOffsetLeft: number;
    visualOffsetTop: number;
  };
}
export interface DiagnosticRequest {
  expected: DiagnosticContext;
  analysis: { width: number; height: number };
  region: { x: number; y: number; width: number; height: number };
}
type Rectangle = DiagnosticRequest['region'];
interface DiagnosticCandidate {
  /** Direct-child positional paths, NOT querySelector selectors. Cross an open shadow root between entries. */
  selectorPath: string[];
  tag: string;
  rect: Rectangle;
  hitCount: number;
  media?: 'VIDEO' | 'CANVAS' | 'IMAGE' | 'IFRAME';
  animation: { running: number; paused: number; finished: number };
}
export interface DiagnosticResult {
  status: 'MAPPED' | 'UNAVAILABLE';
  reason?: string;
  coordinateSpace: 'CSS_VIEWPORT';
  sampledPoints: number;
  region?: Rectangle;
  candidates: DiagnosticCandidate[];
  limitations: string[];
}

const documentToken = crypto.randomUUID();
let viewportRevision = 0;
let viewportRevisionObserved = false;
function observeViewportRevision(): void {
  if (
    viewportRevisionObserved ||
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function'
  )
    return;
  // Content injection is idempotent in content.ts. Install lazily so reinjecting
  // an unused bundle cannot accumulate listeners from abandoned module scopes.
  viewportRevisionObserved = true;
  const changed = () => viewportRevision++;
  window.addEventListener('resize', changed, { passive: true });
  window.visualViewport?.addEventListener?.('resize', changed, {
    passive: true,
  });
}

export interface CssReferenceContext {
  context?: DiagnosticContext;
  pageZoom?: number;
  /** Background-owned counter catches page zoom changed and then restored. */
  zoomRevision: number;
}

/** Endpoint geometry alone cannot detect a resize/zoom that was later undone. */
export function sameCssReferenceContext(
  before: CssReferenceContext | undefined,
  after: CssReferenceContext | undefined,
): boolean {
  const first = before?.context;
  const last = after?.context;
  if (
    !first ||
    !last ||
    !first.url ||
    !first.documentToken ||
    first.url !== last.url ||
    first.documentToken !== last.documentToken ||
    !Number.isSafeInteger(first.viewportRevision) ||
    first.viewportRevision! < 0 ||
    first.viewportRevision !== last.viewportRevision ||
    !Number.isSafeInteger(before?.zoomRevision) ||
    before!.zoomRevision < 0 ||
    before!.zoomRevision !== after?.zoomRevision ||
    before?.pageZoom !== 1 ||
    after?.pageZoom !== 1
  )
    return false;
  const previous = first.viewport;
  const current = last.viewport;
  if (
    !previous ||
    !current ||
    ![previous.width, previous.height, previous.dpr].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    previous.visualScale !== 1 ||
    current.visualScale !== 1
  )
    return false;
  // Scrolling does not alter the CSS-to-source-pixel area mapping.
  return (
    previous.width === current.width &&
    previous.height === current.height &&
    previous.dpr === current.dpr &&
    previous.visualOffsetLeft === 0 &&
    current.visualOffsetLeft === 0 &&
    previous.visualOffsetTop === 0 &&
    current.visualOffsetTop === 0
  );
}

/** Never discard temporal candidates or exact mask counts with a stale reference. */
export function guardCssReferenceContext(
  measurement: { findings: Finding[]; limitations: string[] },
  before: CssReferenceContext | undefined,
  after: CssReferenceContext | undefined,
  navigation = false,
): void {
  if (!navigation && sameCssReferenceContext(before, after)) return;
  for (const finding of measurement.findings)
    if (finding.spatial?.visualField?.basis === 'W3C_CSS_REFERENCE')
      delete finding.spatial.visualField;
  const reason = 'CSS_REFERENCE_CONTEXT_CHANGED_OR_UNAVAILABLE';
  if (!measurement.limitations.includes(reason))
    measurement.limitations.push(reason);
}
const LIMITATIONS = [
  'POST_OBSERVATION_SPATIAL_HINT_NOT_VERIFIED_CAUSE',
  'DOM_MAY_HAVE_CHANGED_SINCE_OBSERVED_FRAMES',
  'HIT_TEST_OMITS_POINTER_EVENTS_NONE_AND_PSEUDO_ELEMENTS',
  'CLOSED_SHADOW_ROOTS_AND_IFRAME_CONTENTS_NOT_INSPECTED',
  'SPARSE_POINT_SAMPLING_MAY_MISS_SOURCES',
];
const nativeTags = new Set(
  'a article aside audio body button canvas details dialog div em fieldset figure figcaption footer form h1 h2 h3 h4 h5 h6 header hr html iframe img input label li main nav ol p picture section select small span strong summary svg table tbody td textarea th thead tr ul video'.split(
    ' ',
  ),
);
const rounded = (value: number) => Math.round(value * 100) / 100;
const rectangle = (rect: DOMRect): Rectangle => ({
  x: rounded(rect.x),
  y: rounded(rect.y),
  width: rounded(rect.width),
  height: rounded(rect.height),
});

export function diagnosticContext(): DiagnosticContext {
  observeViewportRevision();
  return {
    url: location.href,
    documentToken,
    ...(viewportRevisionObserved ? { viewportRevision } : {}),
    viewport: {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      scrollX,
      scrollY,
      visualScale: visualViewport?.scale ?? 1,
      visualOffsetLeft: visualViewport?.offsetLeft ?? 0,
      visualOffsetTop: visualViewport?.offsetTop ?? 0,
    },
  };
}

function unavailable(reason: string): DiagnosticResult {
  return {
    status: 'UNAVAILABLE',
    reason,
    coordinateSpace: 'CSS_VIEWPORT',
    sampledPoints: 0,
    candidates: [],
    limitations: [...LIMITATIONS],
  };
}

/** Positional child paths never expose IDs, classes, custom tag names or text. */
export function structuralDiagnosticPath(
  element: Element,
): string[] | undefined {
  const roots: string[] = [];
  let current: Element | null = element;
  let segments: string[] = [];
  let depth = 0;
  let siblingsVisited = 0;
  while (current) {
    if (++depth > 32) return;
    let position = 1;
    for (
      let sibling = current.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (++siblingsVisited > 2048) return;
      position++;
    }
    segments.unshift(`*:nth-child(${position})`);
    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }
    const selector = segments.join(' > ');
    if (selector.length > 512) return;
    roots.unshift(selector);
    segments = [];
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      if (roots.length >= 8 || root.mode !== 'open') return;
      current = root.host;
    } else {
      if (root !== document) return;
      current = null;
    }
  }
  return roots;
}

/**
 * Resolve only direct children at every step, starting at the provided root.
 * Passing these strings to querySelector is unsafe: an unanchored selector in a
 * shadow root may match a nested sibling before the intended root child.
 */
export function resolveDiagnosticPath(
  path: string[],
  initialRoot: Document | ShadowRoot = document,
): Element | undefined {
  if (!Array.isArray(path) || path.length < 1 || path.length > 8) return;
  let root: Document | ShadowRoot | Element = initialRoot;
  let target: Element | undefined;
  let depth = 0;
  for (const [rootIndex, positionPath] of path.entries()) {
    if (typeof positionPath !== 'string' || positionPath.length > 512) return;
    const steps = positionPath.split(' > ');
    for (const step of steps) {
      if (++depth > 32) return;
      const match = /^\*:nth-child\(([1-9]\d{0,3})\)$/.exec(step);
      const position = match ? Number(match[1]) : 0;
      if (position < 1 || position > 2049) return;
      target = root.children.item(position - 1) ?? undefined;
      if (!target) return;
      root = target;
    }
    if (rootIndex < path.length - 1) {
      if (!target?.shadowRoot || target.shadowRoot.mode !== 'open') return;
      root = target.shadowRoot;
    }
  }
  return target;
}

function animationState(element: Element): DiagnosticCandidate['animation'] {
  const state = { running: 0, paused: 0, finished: 0 };
  // Do not inspect keyframes, timing values, animation names or style content.
  for (const animation of element.getAnimations().slice(0, 32)) {
    if (animation.playState === 'running') state.running++;
    else if (animation.playState === 'paused') state.paused++;
    else if (animation.playState === 'finished') state.finished++;
  }
  return state;
}

export function diagnosticSources(
  request: DiagnosticRequest,
): DiagnosticResult {
  const expected = request?.expected;
  const analysis = request?.analysis;
  const region = request?.region;
  const current = diagnosticContext();
  if (
    !expected ||
    !expected.viewport ||
    typeof expected.url !== 'string' ||
    typeof expected.documentToken !== 'string' ||
    !analysis ||
    !region ||
    ![
      expected.viewport.width,
      expected.viewport.height,
      expected.viewport.dpr,
      expected.viewport.scrollX,
      expected.viewport.scrollY,
      expected.viewport.visualScale,
      expected.viewport.visualOffsetLeft,
      expected.viewport.visualOffsetTop,
      analysis.width,
      analysis.height,
      region.x,
      region.y,
      region.width,
      region.height,
    ].every(Number.isFinite)
  )
    return unavailable('INVALID_DIAGNOSTIC_REQUEST');
  if (
    expected.url !== current.url ||
    expected.documentToken !== current.documentToken
  )
    return unavailable('DOCUMENT_CHANGED');
  const previous = expected.viewport;
  const next = current.viewport;
  if (
    (expected.viewportRevision !== undefined &&
      expected.viewportRevision !== current.viewportRevision) ||
    previous.width !== next.width ||
    previous.height !== next.height ||
    previous.dpr !== next.dpr ||
    previous.visualScale !== next.visualScale ||
    previous.visualOffsetLeft !== next.visualOffsetLeft ||
    previous.visualOffsetTop !== next.visualOffsetTop
  )
    return unavailable('VIEWPORT_CHANGED');
  if (
    Math.abs(previous.scrollX - next.scrollX) > 0.5 ||
    Math.abs(previous.scrollY - next.scrollY) > 0.5
  )
    return unavailable('SCROLL_CHANGED');
  if (
    next.visualScale !== 1 ||
    next.visualOffsetLeft !== 0 ||
    next.visualOffsetTop !== 0 ||
    next.width <= 0 ||
    next.height <= 0 ||
    next.dpr <= 0
  )
    return unavailable('UNSUPPORTED_VIEWPORT_GEOMETRY');
  if (
    !Number.isInteger(analysis.width) ||
    !Number.isInteger(analysis.height) ||
    analysis.width < 1 ||
    analysis.height < 1 ||
    analysis.width > 16384 ||
    analysis.height > 16384 ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > analysis.width ||
    region.y + region.height > analysis.height
  )
    return unavailable('INVALID_ANALYSIS_REGION');
  // Capture downsampling floors each dimension. Allow that one-pixel rounding,
  // but never project a differently shaped capture onto the current viewport.
  const scale = Math.min(
    analysis.width / next.width,
    analysis.height / next.height,
  );
  if (
    Math.abs(analysis.width - next.width * scale) > 1.01 ||
    Math.abs(analysis.height - next.height * scale) > 1.01
  )
    return unavailable('CAPTURE_ASPECT_RATIO_MISMATCH');
  const mapped: Rectangle = {
    x: rounded((region.x / analysis.width) * next.width),
    y: rounded((region.y / analysis.height) * next.height),
    width: rounded((region.width / analysis.width) * next.width),
    height: rounded((region.height / analysis.height) * next.height),
  };
  const candidates = new Map<Element, DiagnosticCandidate>();
  const limitations = [...LIMITATIONS];
  let sampledPoints = 0;
  for (const horizontal of [1 / 6, 1 / 2, 5 / 6]) {
    for (const vertical of [1 / 6, 1 / 2, 5 / 6]) {
      const x = mapped.x + mapped.width * horizontal;
      const y = mapped.y + mapped.height * vertical;
      let hit = document.elementFromPoint(x, y);
      sampledPoints++;
      let depth = 0;
      while (hit?.shadowRoot && depth < 8) {
        const nested = hit.shadowRoot.elementFromPoint(x, y);
        if (!nested || nested === hit) break;
        hit = nested;
        depth++;
      }
      if (depth === 8 && hit?.shadowRoot) {
        limitations.push('SPATIAL_SHADOW_DEPTH_LIMIT_REACHED');
        continue;
      }
      if (!hit?.isConnected) continue;
      const existing = candidates.get(hit);
      if (existing) {
        existing.hitCount++;
        continue;
      }
      if (candidates.size >= 6) {
        limitations.push('SPATIAL_CANDIDATE_LIMIT_REACHED');
        continue;
      }
      const selectorPath = structuralDiagnosticPath(hit);
      if (!selectorPath || resolveDiagnosticPath(selectorPath) !== hit) {
        limitations.push('SPATIAL_SELECTOR_LIMIT_REACHED');
        continue;
      }
      const rect = hit.getBoundingClientRect();
      if (
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        Math.max(Math.abs(rect.x), Math.abs(rect.y), rect.width, rect.height) >
          1_000_000
      )
        continue;
      const tag = hit.localName.toLowerCase();
      const media =
        tag === 'video'
          ? 'VIDEO'
          : tag === 'canvas'
            ? 'CANVAS'
            : tag === 'img'
              ? 'IMAGE'
              : tag === 'iframe'
                ? 'IFRAME'
                : undefined;
      candidates.set(hit, {
        selectorPath,
        tag: nativeTags.has(tag) ? tag : 'custom-element',
        rect: rectangle(rect),
        hitCount: 1,
        ...(media ? { media } : {}),
        animation: animationState(hit),
      });
    }
  }
  return {
    status: candidates.size ? 'MAPPED' : 'UNAVAILABLE',
    ...(candidates.size ? {} : { reason: 'NO_INSPECTABLE_SPATIAL_TARGET' }),
    coordinateSpace: 'CSS_VIEWPORT',
    sampledPoints,
    region: mapped,
    candidates: [...candidates.values()].sort(
      (a, b) => b.hitCount - a.hitCount,
    ),
    limitations: [...new Set(limitations)],
  };
}
