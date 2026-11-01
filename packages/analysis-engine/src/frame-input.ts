import type { CapturedFrame } from './types.js';
function validDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 16384;
}
/** Reject malformed pixels, dimensions and clocks before temporal state can be advanced. */
export function validCapturedFrame(
  frame: CapturedFrame,
  maxPixels: number,
): boolean {
  const { rgba, width, height, timestampMs } = frame;
  return (
    [
      width,
      height,
      frame.sourceWidth ?? width,
      frame.sourceHeight ?? height,
    ].every(validDimension) &&
    width * height <= maxPixels &&
    (rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) &&
    rgba.length === width * height * 4 &&
    Number.isFinite(timestampMs) &&
    timestampMs >= 0
  );
}
