import { validCapturedFrame } from './frame-input.js';
import type { AnalysisOptions, CapturedFrame } from './types.js';
/** Admission and cadence quality are independent of pixel processing. Rejected frames reset
 * temporal history through the supplied callbacks and never advance accepted-frame counters. */
export class FrameQuality {
  readonly minFps: number;
  readonly permittedGap: number;
  readonly maxPixels: number;
  count = 0;
  first = 0;
  last = 0;
  gap = 0;
  downsampled = false;
  interrupted = false;
  sourceWidth = 0;
  sourceHeight = 0;
  invalid = false;
  readonly notes = new Set<string>();
  constructor(options: AnalysisOptions) {
    if (
      options.visualField &&
      (![options.visualField.widthPx, options.visualField.heightPx].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 16384,
      ) ||
        ![
          'EXPLICIT_CALIBRATION',
          'W3C_1024_768_REFERENCE',
          'W3C_CSS_REFERENCE',
        ].includes(options.visualField.basis) ||
        options.visualField.reference.length > 1000 ||
        !options.visualField.reference.length)
    )
      throw new TypeError('Invalid visual-field calibration');
    this.minFps = options.minEffectiveFps ?? 30;
    this.permittedGap = options.maxGapMs ?? 100;
    this.maxPixels = options.maxPixels ?? 640 * 360;
    if (
      !Number.isFinite(this.minFps) ||
      this.minFps <= 0 ||
      !Number.isFinite(this.permittedGap) ||
      this.permittedGap <= 0 ||
      !Number.isInteger(this.maxPixels) ||
      this.maxPixels < 1 ||
      this.maxPixels > 1920 * 1080
    )
      throw new TypeError('Invalid analysis limits');
  }
  /** Accept one well-formed strictly increasing frame; geometry/gaps cannot join histories. */
  admit(
    frame: CapturedFrame,
    current: {
      width: number;
      height: number;
      allocate: (width: number, height: number) => void;
      reset: () => void;
    },
  ): number | undefined {
    const { width, height, timestampMs } = frame;
    const sourceWidth = frame.sourceWidth ?? width;
    const sourceHeight = frame.sourceHeight ?? height;
    if (!validCapturedFrame(frame, this.maxPixels)) {
      this.invalid = true;
      this.notes.add(
        'A malformed or oversized frame was rejected. Capture quality is insufficient.',
      );
      if (this.count) current.reset();
      return undefined;
    }
    if (this.count && timestampMs <= this.last) {
      this.invalid = true;
      this.notes.add(
        'Capture timestamps were not strictly increasing. Rejected frames were not analyzed.',
      );
      current.reset();
      return undefined;
    }
    const relativeTime = this.count ? timestampMs - this.first : 0;
    if (!this.count) {
      this.first = timestampMs;
      if (current.width !== width || current.height !== height)
        current.allocate(width, height);
    } else {
      const gap = timestampMs - this.last;
      this.gap = Math.max(this.gap, gap);
      if (width !== current.width || height !== current.height) {
        this.interrupted = true;
        this.notes.add(
          'Capture dimensions changed; no transitions were joined across the scale change.',
        );
        current.allocate(width, height);
      } else if (
        sourceWidth !== this.sourceWidth ||
        sourceHeight !== this.sourceHeight
      ) {
        this.interrupted = true;
        this.notes.add(
          'Source dimensions changed; no transitions were joined across the viewport change.',
        );
        current.reset();
      } else if (gap > this.permittedGap) current.reset();
    }
    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;
    if (
      (frame.sourceWidth !== undefined && frame.sourceWidth !== width) ||
      (frame.sourceHeight !== undefined && frame.sourceHeight !== height)
    ) {
      this.downsampled = true;
      this.notes.add(
        'Capture was rescaled. Small flashing regions may have been lost and area is not validated.',
      );
    }
    this.last = timestampMs;
    this.count++;

    return relativeTime;
  }
  /** Numeric quality inputs used by result assembly; no captured pixels are retained here. */
  summary() {
    return {
      last: this.last,
      first: this.first,
      count: this.count,
      invalid: this.invalid,
      interrupted: this.interrupted,
      downsampled: this.downsampled,
      minFps: this.minFps,
      gap: this.gap,
      permittedGap: this.permittedGap,
      notes: this.notes,
    };
  }
}
