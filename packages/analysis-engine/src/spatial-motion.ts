/** Exact binary-mask arithmetic. It makes no display-size or safety assumption. */
import type { SpatialEvidence } from '@epi-less/core';

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
    const bounds = { x0, y0, x1, y1, dx, dy, width };
    if (changedRuns && !hasChangedOverlap(changedRuns, bounds)) continue;
    // A changed source coordinate is a useful *rejection* point on otherwise
    // periodic backgrounds. Acceptance still checks every pixel in the overlap.
    // Bounded endpoint checks avoid repeatedly walking millions of unchanged
    // pixels before encountering a small changed region near the bottom edge.
    if (!passesTranslationPrefilters(words, previous, changedRuns, bounds))
      continue;
    if (matchesCompleteOverlap(words, previous, bounds))
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

type TranslationBounds = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dx: number;
  dy: number;
  width: number;
};
function hasChangedOverlap(
  changedRuns: Uint32Array,
  { x0, y0, x1, y1, width }: TranslationBounds,
): boolean {
  let changedOverlap = false;
  for (let run = 0; run < changedRuns.length && !changedOverlap; run += 3) {
    const start = changedRuns[run],
      end = changedRuns[run + 1];
    const firstRow = Math.max(y0, Math.floor(start / width));
    // A contiguous changed run intersects the rectangle either in its first
    // eligible row or the next. Later rows cannot rescue a failed second.
    for (let row = firstRow; row < Math.min(firstRow + 2, y1); row++) {
      if (Math.max(start, row * width + x0) < Math.min(end, row * width + x1)) {
        changedOverlap = true;
        break;
      }
    }
  }
  return changedOverlap;
}
function passesTranslationPrefilters(
  words: Uint32Array,
  previous: Uint32Array,
  changedRuns: Uint32Array | undefined,
  { x0, y0, x1, y1, dx, dy, width }: TranslationBounds,
): boolean {
  let matches = true;
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
  if (!matches) return false;
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
  if (!matches) return false;
  return matches;
}
function matchesCompleteOverlap(
  words: Uint32Array,
  previous: Uint32Array,
  { x0, y0, x1, y1, dx, dy, width }: TranslationBounds,
): boolean {
  let differs = false;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      if (words[i] !== previous[(y - dy) * width + x - dx]) {
        return false;
      }
      if (words[i] !== previous[i]) differs = true;
    }
  return differs;
}
