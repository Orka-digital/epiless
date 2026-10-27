/** Exact binary-mask arithmetic. It makes no display-size or safety assumption. */
import type { SpatialEvidence } from '../../core/src/spatial.js';
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

/** Strict evidence for one narrowly defined pattern, not an exemption classifier.
 * Noise, rotated/irregular patterns and unbalanced images deliberately do not match. */
export function balancedCheckerboard(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  region: { x: number; y: number; width: number; height: number },
  field?: VisualFieldCalibration,
): SpatialEvidence['pattern'] {
  const none: SpatialEvidence['pattern'] = {
    kind: 'NONE_DEMONSTRATED',
    automaticallyExcluded: false,
  };
  const rgb = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return (
      rgba[i] | (rgba[i + 1] << 8) | (rgba[i + 2] << 16) | (rgba[i + 3] << 24)
    );
  };
  const a = rgb(region.x, region.y);
  let cw = 1,
    ch = 1;
  while (cw < region.width && cw <= 32 && rgb(region.x + cw, region.y) === a)
    cw++;
  while (ch < region.height && ch <= 32 && rgb(region.x, region.y + ch) === a)
    ch++;
  if (cw >= region.width || ch >= region.height || cw > 32 || ch > 32)
    return none;
  const b = rgb(region.x + cw, region.y);
  if (
    a === b ||
    rgb(region.x, region.y + ch) !== b ||
    a >>> 24 !== 255 ||
    b >>> 24 !== 255
  )
    return none;
  let first = 0,
    second = 0;
  for (let y = 0; y < region.height; y++)
    for (let x = 0; x < region.width; x++) {
      const expected = (Math.floor(x / cw) + Math.floor(y / ch)) % 2 ? b : a;
      if (rgb(region.x + x, region.y + y) !== expected) return none;
      if (expected === a) first++;
      else second++;
    }
  if (first !== second) return none;
  return {
    kind: 'EXACT_BALANCED_CHECKERBOARD',
    cellWidthPx: cw,
    cellHeightPx: ch,
    ...(field
      ? {
          belowPointOneDegree:
            // Horizontal field spans 10°, vertical field spans 7.5°.
            // Strictly smaller than 0.1° on BOTH axes; integer products avoid
            // a floating division deciding equality differently at the cutoff.
            cw * 100 < field.widthPx && ch * 75 < field.heightPx,
        }
      : {}),
    automaticallyExcluded: false,
  };
}

/** Two consecutive accepted frames, with the SAME two opaque colours exchanged
 * at every pixel of a spatially balanced component. This describes only this
 * frame pair, not balance throughout the flash period or an exemption. The
 * caller supplies timestamps only while its previous-frame epoch is valid. */
export function exactCheckerboardInverse(
  current: Uint8Array | Uint8ClampedArray,
  previous: Uint32Array | undefined,
  width: number,
  region: { x: number; y: number; width: number; height: number },
  previousSampledAtMs: number | undefined,
  currentSampledAtMs: number,
): SpatialEvidence['pattern']['inversePhase'] {
  if (
    !previous ||
    previousSampledAtMs === undefined ||
    !Number.isFinite(previousSampledAtMs) ||
    previousSampledAtMs < 0 ||
    !Number.isFinite(currentSampledAtMs) ||
    currentSampledAtMs <= previousSampledAtMs ||
    !Number.isInteger(width) ||
    width < 1 ||
    current.length !== previous.length * 4 ||
    current.length % (width * 4) !== 0 ||
    ![region.x, region.y, region.width, region.height].every(
      Number.isInteger,
    ) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.x + region.width > width ||
    region.y + region.height > current.length / (width * 4)
  )
    return undefined;
  const pattern = balancedCheckerboard(current, width, region);
  if (pattern.kind !== 'EXACT_BALANCED_CHECKERBOARD') return undefined;
  // Read bytes, rather than assume the platform endianness of Uint32Array.
  const prior = new Uint8Array(
    previous.buffer,
    previous.byteOffset,
    previous.byteLength,
  );
  const color = (bytes: Uint8Array | Uint8ClampedArray, pixel: number) => {
    const at = pixel * 4;
    return (
      bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)
    );
  };
  const first = color(current, region.y * width + region.x);
  const second = color(
    current,
    region.y * width + region.x + pattern.cellWidthPx!,
  );
  let firstColorPixels = 0,
    secondColorPixels = 0;
  for (let y = region.y; y < region.y + region.height; y++)
    for (let x = region.x; x < region.x + region.width; x++) {
      const pixel = y * width + x;
      const value = color(current, pixel);
      if (color(prior, pixel) !== (value === first ? second : first))
        return undefined;
      if (value === first) firstColorPixels++;
      else secondColorPixels++;
    }
  return {
    kind: 'EXACT_TWO_FRAME_INVERSE',
    previousSampledAtMs,
    currentSampledAtMs,
    comparedPixels: firstColorPixels + secondColorPixels,
    firstColorPixels,
    secondColorPixels,
  };
}

/** A verified exact translated overlap is compatible with movement; it cannot
 * establish causality (a periodic pattern can have the same pixels as flashing).
 * Search is bounded to integer offsets ±8, then the WHOLE overlap is verified. */
export function exactTranslation(
  current: Uint8Array | Uint8ClampedArray,
  previous: Uint32Array | undefined,
  width: number,
  height: number,
  changedRuns?: Uint32Array,
): SpatialEvidence['motion'] {
  const none: SpatialEvidence['motion'] = {
    kind: 'NONE_DEMONSTRATED',
    automaticallyExcluded: false,
  };
  if (!previous || current.byteOffset % 4 || previous.length !== width * height)
    return none;
  const words = new Uint32Array(
    current.buffer,
    current.byteOffset,
    current.byteLength / 4,
  );
  const offsets: [number, number][] = [];
  for (let d = 1; d <= 8; d++)
    offsets.push(
      [d, 0],
      [-d, 0],
      [0, d],
      [0, -d],
      [d, d],
      [-d, -d],
      [d, -d],
      [-d, d],
    );
  for (const [dx, dy] of offsets) {
    const x0 = Math.max(0, dx),
      y0 = Math.max(0, dy),
      x1 = Math.min(width, width + dx),
      y1 = Math.min(height, height + dy);
    const comparedPixels = (x1 - x0) * (y1 - y0);
    if (x1 <= x0 || y1 <= y0 || comparedPixels < width * height * 0.75)
      continue;
    let matches = true,
      differs = false;
    if (changedRuns) {
      let changedOverlap = false;
      for (let run = 0; run < changedRuns.length && !changedOverlap; run += 3) {
        const start = changedRuns[run],
          end = changedRuns[run + 1];
        const firstRow = Math.max(y0, Math.floor(start / width));
        // A contiguous changed run intersects the rectangle either in its first
        // eligible row or the next. Later rows cannot rescue a failed second.
        for (let row = firstRow; row < Math.min(firstRow + 2, y1); row++) {
          if (
            Math.max(start, row * width + x0) < Math.min(end, row * width + x1)
          ) {
            changedOverlap = true;
            break;
          }
        }
      }
      if (!changedOverlap) continue; // Identical overlap cannot demonstrate motion.
    }
    // A changed source coordinate is a useful *rejection* point on otherwise
    // periodic backgrounds. Acceptance still checks every pixel in the overlap.
    // Bounded endpoint checks avoid repeatedly walking millions of unchanged
    // pixels before encountering a small changed region near the bottom edge.
    const runs = (changedRuns?.length ?? 0) / 3;
    for (let sample = 0; sample < Math.min(runs, 8) && matches; sample++) {
      const run = Math.floor((sample * runs) / Math.min(runs, 8)) * 3;
      for (const pixel of [changedRuns![run], changedRuns![run + 1] - 1]) {
        const x = pixel % width,
          y = Math.floor(pixel / width);
        if (
          x >= x0 &&
          x < x1 &&
          y >= y0 &&
          y < y1 &&
          words[pixel] !== previous[(y - dy) * width + x - dx]
        ) {
          matches = false;
          break;
        }
      }
    }
    if (!matches) continue;
    // Deterministic rejection grid is only a fast prefilter, never acceptance.
    for (let gy = 0; gy < 8 && matches; gy++)
      for (let gx = 0; gx < 8; gx++) {
        const x = x0 + Math.floor((gx * (x1 - x0 - 1)) / 7),
          y = y0 + Math.floor((gy * (y1 - y0 - 1)) / 7);
        if (words[y * width + x] !== previous[(y - dy) * width + x - dx]) {
          matches = false;
          break;
        }
      }
    if (!matches) continue;
    outer: for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * width + x;
        if (words[i] !== previous[(y - dy) * width + x - dx]) {
          matches = false;
          break outer;
        }
        if (words[i] !== previous[i]) differs = true;
      }
    if (matches && differs)
      return {
        kind: 'EXACT_TRANSLATION_COMPATIBLE',
        dx,
        dy,
        comparedPixels,
        overlapRatio: comparedPixels / (width * height),
        automaticallyExcluded: false,
      };
  }
  return none;
}
