import type { Finding, SpatialEvidence } from '@epi-less/core';

import { DiagnosticHistory } from './diagnostic-history.js';

import {
  combinedMaskFieldAnalysis,
  type VisualFieldCalibration,
} from './spatial.js';

import {
  OpposingPairHistory,
  TransitionHistory,
} from './transition-history.js';

export interface ClusterContext {
  readonly width: number;
  readonly height: number;
  readonly downsampled: boolean;
  readonly visualField: VisualFieldCalibration | undefined;
  readonly queue: Int32Array<ArrayBufferLike>;
  readonly representatives: Uint32Array<ArrayBufferLike>;
  readonly findings: Finding[];
  readonly mergeFrom: number;
  readonly currentRgba:
    | Uint8Array<ArrayBufferLike>
    | Uint8ClampedArray<ArrayBufferLike>
    | undefined;
  readonly previousFrame: Uint32Array<ArrayBufferLike> | undefined;
  readonly previousFrameAtMs: number | undefined;
  readonly currentMotion: SpatialEvidence['motion'];
  readonly diagnosticHistory: DiagnosticHistory | undefined;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly onCandidate: ((finding: Finding) => void) | undefined;
  readonly notes: Set<string>;
}

/** Measure the simultaneous active mask within calibrated windows; full-mask shortcuts preserve exact counts. */
export function measureActiveArea(
  context: ClusterContext,
  history: TransitionHistory | OpposingPairHistory,
  calibration: VisualFieldCalibration | undefined,
  fullMask: boolean,
  pixels: number,
) {
  const fullFieldPixels = calibration
    ? Math.min(context.width, calibration.widthPx) *
      Math.min(context.height, calibration.heightPx)
    : 0;
  const area = calibration
    ? fullMask
      ? {
          // The exact active count already proves every source pixel is one.
          // Every maximal overlap ties; retain the generic solver's first
          // window and full field denominator, including outside the image.
          totalPixels: pixels,
          maximumPixels: fullFieldPixels,
          fieldWidth: calibration.widthPx,
          fieldHeight: calibration.heightPx,
          maximumRatio:
            fullFieldPixels / (calibration.widthPx * calibration.heightPx),
          thresholdRatio: 0.25 as const,
          exceedsThreshold:
            fullFieldPixels * 4 > calibration.widthPx * calibration.heightPx,
          window: {
            x: 0,
            y: 0,
            width: calibration.widthPx,
            height: calibration.heightPx,
          },
        }
      : combinedMaskFieldAnalysis(
          history.active,
          context.width,
          context.height,
          calibration.widthPx,
          calibration.heightPx,
        )
    : undefined;
  return area;
}

/** Consume one connected active component in place, retaining its bounds, first timestamp and pixel count. */
export function consumeComponent(
  context: ClusterContext,
  history: TransitionHistory | OpposingPairHistory,
  seed: number,
  ended: number,
  fullMask: boolean,
  pixels: number,
) {
  let head = 0;
  let tail = 1;
  let minX = context.width,
    minY = context.height,
    maxX = 0,
    maxY = 0,
    started = ended;
  context.queue[0] = seed;
  history.active[seed] = 0;
  if (fullMask) {
    // A homogeneous/full active mask is one exact connected component.
    // Avoid a multi-million-element flood fill on the most severe case.
    head = tail = pixels;
    minX = minY = 0;
    maxX = context.width - 1;
    maxY = context.height - 1;
    started = history.earliestActive;
    history.active.fill(0);
  }
  while (head < tail) {
    const pixel = context.queue[head++];
    const x = pixel % context.width;
    const y = Math.floor(pixel / context.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    started = Math.min(
      started,
      history.started(context.representatives[pixel]),
    );
    // Keep this allocation-free: a closure per native pixel made a full-HD
    // candidate pause the worker for hundreds of milliseconds.
    if (x > 0 && history.active[pixel - 1]) {
      history.active[pixel - 1] = 0;
      context.queue[tail++] = pixel - 1;
    }
    if (x + 1 < context.width && history.active[pixel + 1]) {
      history.active[pixel + 1] = 0;
      context.queue[tail++] = pixel + 1;
    }
    if (y > 0 && history.active[pixel - context.width]) {
      history.active[pixel - context.width] = 0;
      context.queue[tail++] = pixel - context.width;
    }
    if (y + 1 < context.height && history.active[pixel + context.width]) {
      history.active[pixel + context.width] = 0;
      context.queue[tail++] = pixel + context.width;
    }
  }
  const region = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
  return { region, started, tail };
}
