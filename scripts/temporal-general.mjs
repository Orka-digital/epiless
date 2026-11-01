/** Numeric review only: no engine import, playback, changed labels or baseline updates. */
import assert from 'node:assert/strict';

import { changes, sign } from './temporal-colors.mjs';

/** Adjacent extrema after removing equal samples; never sum distinct reversals. */
/**
 * @param {ReturnType<typeof import('./temporal-colors.mjs').parse>} points
 */
function extrema(points) {
  return points.filter(
    (point, i) =>
      !i ||
      i === points.length - 1 ||
      sign(point.luminance - points[i - 1].luminance) !==
        sign(points[i + 1].luminance - point.luminance),
  );
}

/**
 * @param {ReturnType<typeof import('./temporal-colors.mjs').parse>} points
 */
function generalEdges(points) {
  return points.slice(1).map((point, i) => {
    const previous = points[i];
    const delta = point.luminance - previous.luminance;
    const darker = Math.min(point.luminance, previous.luminance);
    return {
      fromFrame: previous.frame,
      toFrame: point.frame,
      endMs: point.timeMs,
      delta,
      darker,
      qualifies: Math.abs(delta) >= 0.1 && darker < 0.8,
    };
  });
}

/**
 * @param {ReturnType<typeof import('./temporal-colors.mjs').parse>} samples
 * @param {boolean} detailed
 */
export function generalTrace(samples, detailed) {
  const points = changes(samples);
  const peaks = extrema(points);
  // A one-second interval whose initial state is actually held by source frame 3.
  // This is a step-plot calculation, not an inserted/duplicated video frame.
  const startMs = 90;
  const endMs = 1090;
  const initial = samples.findLast((sample) => sample.timeMs <= startMs);
  assert(initial);
  assert((samples.at(-1)?.timeMs ?? -Infinity) >= endMs);
  const windowPoints = [
    initial,
    ...points.filter((point) => point.timeMs > startMs && point.timeMs < endMs),
  ];
  const windowEdges = generalEdges(extrema(windowPoints));
  assert.equal(windowEdges.length, 7);
  assert(windowEdges.every((edge) => edge.qualifies));
  assert(
    windowEdges.every(
      (edge, i) => !i || edge.delta * windowEdges[i - 1].delta < 0,
    ),
  );
  if (!detailed) {
    const edges = generalEdges(peaks);
    return {
      extremaFrames: peaks.map((point) => point.frame),
      qualifyingExtremumEdges: edges.filter((edge) => edge.qualifies).length,
      minimumExtremumDelta: Math.min(
        ...edges.map((edge) => Math.abs(edge.delta)),
      ),
      maximumDarkerLuminance: Math.max(...edges.map((edge) => edge.darker)),
      witnessWindow: {
        startMs,
        endMs,
        initialHeldSourceFrame: initial.frame,
        initialHeldSourceFrameTimestampMs: initial.timeMs,
        qualifyingAlternatingTransitionFrames: windowEdges.map(
          (edge) => edge.toFrame,
        ),
        transitionEndTimesMs: windowEdges.map((edge) => edge.endMs),
      },
    };
  }
  return {
    changePoints: points.map(({ frame, timeMs, rgb, luminance }) => ({
      frame,
      timeMs,
      rgb,
      luminance,
    })),
    adjacentStepEdges: generalEdges(points),
    extremaFrames: peaks.map((point) => point.frame),
    extremumEdges: generalEdges(peaks),
    witnessWindow: {
      startMs,
      endMs,
      initialHeldSourceFrame: initial.frame,
      initialHeldSourceFrameTimestampMs: initial.timeMs,
      qualifyingAlternatingTransitions: windowEdges,
    },
  };
}
