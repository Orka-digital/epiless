import type { AnalysisResult } from '@epi-less/analysis-engine';

import {
  CaptureCoverage,
  validateCaptureViewport,
  withCaptureCoverage,
} from './capture-quality';

import { negotiateViewport } from './offscreen-source';

import { captureState } from './offscreen-state';

import { workerRequest } from './offscreen-worker';

/** Negotiate source geometry and begin analysis under the active segment; reject missing capture prerequisites. */
export async function beginSegment(
  message: SegmentMessage,
  commandRevision: number,
) {
  captureState.collecting = false;
  const requestedViewport = message.expectedViewport ?? message.sourceViewport;
  const validatedViewport =
    requestedViewport === undefined
      ? undefined
      : validateCaptureViewport(requestedViewport);
  await negotiateViewport(validatedViewport);
  if (
    message.generation !== captureState.captureGeneration ||
    commandRevision !== captureState.captureRevision ||
    !captureState.analysis ||
    !captureState.stream?.active
  )
    throw new Error('Capture session ended during viewport negotiation');
  const sourceGeometry = validatedViewport
    ? {
        width: Math.round(validatedViewport.width * validatedViewport.dpr),
        height: Math.round(validatedViewport.height * validatedViewport.dpr),
      }
    : captureState.lastDecodedGeometry;
  await workerRequest(
    'BEGIN',
    undefined,
    sourceGeometry,
    message.referenceMapping,
  );
  if (
    message.generation !== captureState.captureGeneration ||
    commandRevision !== captureState.captureRevision ||
    !captureState.analysis ||
    !captureState.stream?.active
  )
    throw new Error('Capture session ended during analysis preparation');
  captureState.inFlightFrames = 0;
  captureState.skipped = 0;
  captureState.segmentId =
    typeof message.segmentId === 'string' ? message.segmentId : '';
  captureState.sourceFrameClock.reset();
  captureState.expectedViewport = undefined;
  captureState.geometryMismatches = 0;
  captureState.lastMismatchedGeometry = '';
  captureState.expectedViewport = validatedViewport;
  captureState.presentedFrames = 0;
  captureState.coverage = new CaptureCoverage(performance.now());
  captureState.collecting = true;
  return {};
}

/** Flush queued analysis and finish the current segment without attributing later frames to it. */
export async function endSegment(
  message: SegmentMessage,
  commandRevision: number,
) {
  captureState.collecting = false;
  const window = captureState.coverage?.finish(performance.now());
  captureState.coverage = undefined;
  const skippedBeforeEnd = captureState.skipped;
  const measurement = (await workerRequest(
    'END',
    captureState.geometryMismatches && captureState.expectedViewport
      ? `CAPTURE_VIEWPORT_MISMATCH: ${captureState.geometryMismatches} decoded frames (${captureState.lastMismatchedGeometry} latest) did not match ${Math.round(captureState.expectedViewport.width * captureState.expectedViewport.dpr)}x${Math.round(captureState.expectedViewport.height * captureState.expectedViewport.dpr)} source pixels for the requested ${captureState.expectedViewport.width}x${captureState.expectedViewport.height} CSS viewport at DPR ${captureState.expectedViewport.dpr}. Those frames were not analyzed.`
      : message.interruption ||
          (captureState.skipped
            ? `${captureState.skipped} source/analysis frames were skipped or unavailable.`
            : undefined),
  )) as AnalysisResult;
  if (
    message.generation !== captureState.captureGeneration ||
    commandRevision !== captureState.captureRevision ||
    !captureState.stream?.active
  )
    throw new Error('Capture session ended while draining analysis');
  // END is queued behind every transferred frame. A queued conversion can
  // still fail after END was requested; retain that failure in the result.
  if (captureState.skipped > skippedBeforeEnd) {
    measurement.status = 'INCONCLUSIVE';
    measurement.quality.interrupted = true;
    measurement.limitations.push(
      `${captureState.skipped - skippedBeforeEnd} queued source/analysis frames failed while completing the segment; ${captureState.skipped} total frames were skipped or unavailable.`,
    );
  }
  const settings = captureState.stream.getVideoTracks()[0]?.getSettings();
  if (measurement.quality.processing && settings) {
    const details = settings as MediaTrackSettings & {
      resizeMode?: string;
    };
    measurement.quality.processing.track = {
      ...(settings.width ? { width: settings.width } : {}),
      ...(settings.height ? { height: settings.height } : {}),
      ...(Number.isFinite(settings.frameRate)
        ? { frameRate: settings.frameRate }
        : {}),
      ...(details.resizeMode ? { resizeMode: details.resizeMode } : {}),
    };
  }
  return window ? withCaptureCoverage(measurement, window) : measurement;
}

interface SegmentMessage {
  generation: string;
  expectedViewport?: unknown;
  sourceViewport?: unknown;
  referenceMapping?: unknown;
  segmentId?: unknown;
  interruption?: string;
}
