/** Numeric review only: no engine import, playback, changed labels or baseline updates. */
import assert from 'node:assert/strict';

export const sign = (/** @type {number} */ value) =>
  value > 0 ? 1 : value < 0 ? -1 : 0;

export const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) =>
  a[0] * b[0] + a[1] * b[1];

/**
 * @param {number[]} rgb
 */
function color(rgb) {
  const [r, g, b] = rgb.map((byte) => {
    const encoded = byte / 255;
    return encoded <= 0.04045
      ? encoded / 12.92
      : ((encoded + 0.055) / 1.055) ** 2.4;
  });
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const divisor = x + 15 * y + 3 * z;
  assert(divisor > 0, 'These selected sources have defined chromaticity');
  return {
    luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
    redFraction: r / (r + g + b),
    uv: [(4 * x) / divisor, (9 * y) / divisor],
  };
}

/**
 * @param {string} csv
 */
export function parse(csv) {
  const [header, ...rows] = csv.trimEnd().split(/\r?\n/);
  assert.equal(header, 'sRGBA,r,g,b,a');
  return rows.map((row, i) => {
    const cells = row.split(',');
    assert(cells.length === 5 && cells.every((cell) => /^\d+$/.test(cell)));
    const [frame, r, g, b, a] = cells.map(Number);
    assert.equal(frame, i + 1);
    assert.equal(a, 255);
    assert([r, g, b].every((value) => value <= 255));
    const rgb = [r, g, b];
    return { frame, timeMs: (i * 1000) / 30, rgb, ...color(rgb) };
  });
}

/**
 * @param {ReturnType<typeof parse>} samples
 */
export function changes(samples) {
  return samples.filter(
    (sample, i) =>
      !i ||
      sample.rgb.some(
        (value, channel) => value !== samples[i - 1].rgb[channel],
      ),
  );
}
