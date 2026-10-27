import type { AnalysisResult } from '@epi-less/analysis-engine';

export const NATIVE_PIXEL_BUDGET = 1920 * 1080;
export interface CaptureViewport {
  width: number;
  height: number;
  dpr: number;
}
export function validateCaptureViewport(input: unknown): CaptureViewport {
  const value = input as Partial<CaptureViewport> | null;
  if (
    !value ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number' ||
    typeof value.dpr !== 'number'
  )
    throw new TypeError('Invalid expected capture viewport');
  const { width, height, dpr } = value;
  if (
    ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 16384) ||
    !Number.isFinite(dpr) ||
    dpr <= 0 ||
    dpr > 16 ||
    ![Math.round(width * dpr), Math.round(height * dpr)].every(
      (n) => n >= 1 && n <= 16384,
    )
  )
    throw new TypeError('Invalid expected capture viewport');
  return { width, height, dpr };
}
/** Preserve every source pixel within budget. Oversized sources are explicitly
 * rescaled; their original dimensions survive and the engine stays inconclusive. */
export function captureDimensions(sourceWidth: number, sourceHeight: number) {
  if (
    ![sourceWidth, sourceHeight].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 16384,
    )
  )
    throw new TypeError('Invalid source capture dimensions');
  const ratio = Math.min(
    1,
    Math.sqrt(NATIVE_PIXEL_BUDGET / (sourceWidth * sourceHeight)),
  );
  return {
    width: Math.max(1, Math.floor(sourceWidth * ratio)),
    height: Math.max(1, Math.floor(sourceHeight * ratio)),
  };
}

export interface CaptureWindow {
  captureWindowMs: number;
  leadingIdleMs: number;
  trailingIdleMs: number;
  submittedFrames: number;
}

/** Wall-clock coverage is separate from the timestamps of decoded source frames. */
export class CaptureCoverage {
  private firstFrameAt: number | undefined;
  private lastFrameAt: number | undefined;
  private submittedFrames = 0;

  constructor(private readonly startedAt: number) {}

  frameSubmitted(at: number): void {
    this.firstFrameAt ??= at;
    this.lastFrameAt = at;
    this.submittedFrames++;
  }

  finish(endedAt: number): CaptureWindow {
    const captureWindowMs = Math.max(0, endedAt - this.startedAt);
    return {
      captureWindowMs,
      leadingIdleMs: Math.min(
        captureWindowMs,
        Math.max(0, (this.firstFrameAt ?? endedAt) - this.startedAt),
      ),
      trailingIdleMs: Math.min(
        captureWindowMs,
        Math.max(0, endedAt - (this.lastFrameAt ?? this.startedAt)),
      ),
      submittedFrames: this.submittedFrames,
    };
  }
}

export function withCaptureCoverage(
  measurement: AnalysisResult,
  coverage: CaptureWindow,
): AnalysisResult {
  const { captureWindowMs, leadingIdleMs, trailingIdleMs, submittedFrames } =
    coverage;
  const incomplete =
    submittedFrames === 0 || leadingIdleMs > 100 || trailingIdleMs > 100;
  const limitations = [...measurement.limitations];
  if (!submittedFrames) {
    limitations.push(
      `No decoded source frame was submitted during the ${captureWindowMs.toFixed(1)} ms capture window. Static source suppression and capture loss cannot be distinguished; continuity is unconfirmed.`,
    );
  } else {
    if (leadingIdleMs > 100)
      limitations.push(
        `The capture window began ${leadingIdleMs.toFixed(1)} ms before its first submitted decoded frame. This leading interval is unobserved.`,
      );
    if (trailingIdleMs > 100)
      limitations.push(
        `No new decoded source frame was submitted during the final ${trailingIdleMs.toFixed(1)} ms of the capture window. Static source suppression and capture loss cannot be distinguished; continuity is unconfirmed.`,
      );
    if (leadingIdleMs > 100 || measurement.findings.length)
      limitations.push(
        'Candidate start/end times are relative to the first analyzed decoded frame, not the scenario start. Leading capture delay is reported separately; source and wall-clock timestamps are not interchangeable.',
      );
  }
  return {
    ...measurement,
    status: incomplete ? 'INCONCLUSIVE' : measurement.status,
    quality: {
      ...measurement.quality,
      captureWindowMs,
      leadingIdleMs,
      trailingIdleMs,
      interrupted: measurement.quality.interrupted || incomplete,
    },
    limitations,
  };
}
