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

export type Rectangle = DiagnosticRequest['region'];

export interface DiagnosticCandidate {
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
    before.zoomRevision < 0 ||
    before.zoomRevision !== after?.zoomRevision ||
    before.pageZoom !== 1 ||
    after?.pageZoom !== 1
  )
    return false;
  return sameCssGeometry(first, last);
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

/** Sample ephemeral document and viewport identity; these values must not enter public reports. */
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

function sameCssGeometry(
  first: DiagnosticContext,
  last: DiagnosticContext,
): boolean {
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
