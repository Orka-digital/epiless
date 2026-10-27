import assert from 'node:assert/strict';
import { nativeLoopPage } from './native-loop-page.mjs';

export const LOOP_CADENCE_POLICY = Object.freeze({
  id: 'CONSTANT_VIDEO_GENTLE_MARKER_2S',
  markerWidthCssPx: 4,
  markerHeightCssPx: 4,
  markerColor: '#e8e8e8',
  backgroundColor: '#eee',
  travelCssPx: 180,
  oneWayDurationMs: 2000,
  timing: 'linear',
  direction: 'alternate',
  boundary:
    'Explicit capture-cadence stimulus only; the constant encoded video is unchanged. This does not establish why the original slow-marker capture had inadequate cadence.',
});

/** A separate opt-in fixture; preserve the original source and generated video. */
export function nativeLoopCadencePage(encoded) {
  const original = nativeLoopPage(encoded);
  const from = 'animation:gentle 20s linear infinite alternate';
  assert.equal(original.split(from).length, 2);
  return original.replace(
    from,
    'animation:gentle 2s linear infinite alternate',
  );
}
