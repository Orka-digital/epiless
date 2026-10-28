/** Exact binary-mask arithmetic. It makes no display-size or safety assumption. */

export interface MaskFieldAnalysis {
  totalPixels: number;
  maximumPixels: number;
  fieldWidth: number;
  fieldHeight: number;
  maximumRatio: number;
  thresholdRatio: 0.25;
  exceedsThreshold: boolean;
  window: { x: number; y: number; width: number; height: number };
}

/** Sum ALL concurrently active regions within every integer-positioned field.
 * Disconnected components count together. Exactly 25% does not exceed 25%.
 * A field larger than the image retains its full denominator (outside is zero).
 * O(width × height) time, O(width) scratch, no rectangle/bounding-box area proxy. */
export function combinedMaskFieldAnalysis(
  mask: Uint8Array,
  width: number,
  height: number,
  fieldWidth: number,
  fieldHeight: number,
): MaskFieldAnalysis {
  if (
    ![width, height, fieldWidth, fieldHeight].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 16384,
    ) ||
    mask.length !== width * height ||
    width * height > 1920 * 1080
  )
    throw new TypeError('Invalid spatial mask or field dimensions');
  const columns = new Uint32Array(width);
  const ww = Math.min(width, fieldWidth),
    hh = Math.min(height, fieldHeight);
  let totalPixels = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 1) throw new TypeError('Expected a binary spatial mask');
    totalPixels += mask[i];
  }
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < width; x++) columns[x] += mask[y * width + x];
  let maximumPixels = -1,
    bx = 0,
    by = 0;
  for (let y = 0; y <= height - hh; y++) {
    if (y)
      for (let x = 0; x < width; x++)
        columns[x] +=
          mask[(y + hh - 1) * width + x] - mask[(y - 1) * width + x];
    let sum = 0;
    for (let x = 0; x < ww; x++) sum += columns[x];
    for (let x = 0; x <= width - ww; x++) {
      if (x) sum += columns[x + ww - 1] - columns[x - 1];
      if (sum > maximumPixels) {
        maximumPixels = sum;
        bx = x;
        by = y;
      }
    }
  }
  return {
    totalPixels,
    maximumPixels,
    fieldWidth,
    fieldHeight,
    maximumRatio: maximumPixels / (fieldWidth * fieldHeight),
    thresholdRatio: 0.25,
    exceedsThreshold: maximumPixels * 4 > fieldWidth * fieldHeight,
    window: { x: bx, y: by, width: fieldWidth, height: fieldHeight },
  };
}

export interface VisualFieldCalibration {
  /** Source capture pixels spanning a nominal 10° wide × 7.5° high rectangle.
   * All supported bases use the W3C G176 4:3 approximation, not a 10° square. */
  widthPx: number;
  heightPx: number;
  basis:
    'EXPLICIT_CALIBRATION' | 'W3C_1024_768_REFERENCE' | 'W3C_CSS_REFERENCE';
  reference: string;
}

/** W3C G176 Formula 2's explicit 4:3 viewing-field approximation.
 * https://www.w3.org/WAI/WCAG22/Techniques/general/G176#formula-2-small-safe-area-for-known-displays
 * Uses the published small-angle factors, then rounds each extent to the nearest
 * source pixel. That quantization is not an exact solid-angle or conservative
 * continuous-area bound. Actual viewing distance remains an input assumption. */
export function visualFieldFromDisplay(input: {
  screenWidthPx: number;
  screenHeightPx: number;
  screenWidthMm: number;
  screenHeightMm: number;
  viewingDistanceMm: number;
}): VisualFieldCalibration {
  if (
    !Object.values(input).every((n) => Number.isFinite(n) && n > 0) ||
    !Number.isInteger(input.screenWidthPx) ||
    !Number.isInteger(input.screenHeightPx) ||
    input.screenWidthPx > 16384 ||
    input.screenHeightPx > 16384
  )
    throw new TypeError('Invalid explicit viewing geometry');
  const widthMm = input.viewingDistanceMm * 0.1745;
  const heightMm = input.viewingDistanceMm * 0.1309;
  const widthPx = Math.round(
    (widthMm * input.screenWidthPx) / input.screenWidthMm,
  );
  const heightPx = Math.round(
    (heightMm * input.screenHeightPx) / input.screenHeightMm,
  );
  if (widthPx < 1 || heightPx < 1 || widthPx > 16384 || heightPx > 16384)
    throw new TypeError('Viewing field is outside supported dimensions');
  return {
    widthPx,
    heightPx,
    basis: 'EXPLICIT_CALIBRATION',
    reference: `W3C G176 Formula 2 approximation, 10 by 7.5 degrees; ${input.screenWidthPx}x${input.screenHeightPx} source pixels on ${input.screenWidthMm}x${input.screenHeightMm} mm at ${input.viewingDistanceMm} mm. Factors 0.1745 and 0.1309; each extent rounded to nearest source pixel. Not an exact solid-angle or conservative continuous-area bound.`,
  };
}
export { exactTranslation } from './spatial-motion.js';
export {
  balancedCheckerboard,
  exactCheckerboardInverse,
} from './spatial-pattern.js';
