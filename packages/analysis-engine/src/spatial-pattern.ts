/** Exact binary-mask arithmetic. It makes no display-size or safety assumption. */
import type { SpatialEvidence } from '@epi-less/core';
import { type VisualFieldCalibration } from './spatial.js';

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
  if (!hasBalancedCells(rgb, region, cw, ch, a, b)) return none;
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
    !validInverseGeometry(current, previous, width, region)
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

function hasBalancedCells(
  rgb: (x: number, y: number) => number,
  region: { x: number; y: number; width: number; height: number },
  cw: number,
  ch: number,
  a: number,
  b: number,
): boolean {
  let first = 0,
    second = 0;
  for (let y = 0; y < region.height; y++)
    for (let x = 0; x < region.width; x++) {
      const expected = (Math.floor(x / cw) + Math.floor(y / ch)) % 2 ? b : a;
      if (rgb(region.x + x, region.y + y) !== expected) return false;
      if (expected === a) first++;
      else second++;
    }
  if (first !== second) return false;
  return true;
}

function validInverseGeometry(
  current: Uint8Array | Uint8ClampedArray,
  previous: Uint32Array,
  width: number,
  region: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
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
  );
}
