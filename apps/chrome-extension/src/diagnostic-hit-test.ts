/**
 * Read-only, post-observation spatial hints. A hit-tested element is NOT proof
 * that it generated a previously observed flash. No page content is collected.
 */
import { type DiagnosticCandidate, type Rectangle } from './diagnostic-context';

import {
  resolveDiagnosticPath,
  structuralDiagnosticPath,
} from './diagnostic-path';

const nativeTags = new Set(
  'a article aside audio body button canvas details dialog div em fieldset figure figcaption footer form h1 h2 h3 h4 h5 h6 header hr html iframe img input label li main nav ol p picture section select small span strong summary svg table tbody td textarea th thead tr ul video'.split(
    ' ',
  ),
);

export const rounded = (value: number) => Math.round(value * 100) / 100;

const rectangle = (rect: DOMRect): Rectangle => ({
  x: rounded(rect.x),
  y: rounded(rect.y),
  width: rounded(rect.width),
  height: rounded(rect.height),
});

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

/** Collect bounded visible structural candidates at one mapped point; hit tests do not establish causality. */
export function sampleDiagnosticPoint(
  x: number,
  y: number,
  candidates: Map<Element, DiagnosticCandidate>,
  limitations: string[],
): void {
  let hit = document.elementFromPoint(x, y);

  let depth = 0;
  while (hit?.shadowRoot && depth < 8) {
    const nested = hit.shadowRoot.elementFromPoint(x, y);
    if (!nested || nested === hit) break;
    hit = nested;
    depth++;
  }
  if (depth === 8 && hit?.shadowRoot) {
    limitations.push('SPATIAL_SHADOW_DEPTH_LIMIT_REACHED');
    return;
  }
  if (!hit?.isConnected) return;
  recordDiagnosticCandidate(hit, candidates, limitations);
}

function recordDiagnosticCandidate(
  hit: Element,
  candidates: Map<Element, DiagnosticCandidate>,
  limitations: string[],
): void {
  const existing = candidates.get(hit);
  if (existing) {
    existing.hitCount++;
    return;
  }
  if (candidates.size >= 6) {
    limitations.push('SPATIAL_CANDIDATE_LIMIT_REACHED');
    return;
  }
  const selectorPath = structuralDiagnosticPath(hit);
  if (!selectorPath || resolveDiagnosticPath(selectorPath) !== hit) {
    limitations.push('SPATIAL_SELECTOR_LIMIT_REACHED');
    return;
  }
  const rect = hit.getBoundingClientRect();
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    Math.max(Math.abs(rect.x), Math.abs(rect.y), rect.width, rect.height) >
      1_000_000
  )
    return;
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
