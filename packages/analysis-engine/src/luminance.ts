import { linear } from './color-cache.js';
/** Compute relative luminance from linearized sRGB channels. */
export function relativeLuminance(
  red: number,
  green: number,
  blue: number,
): number {
  for (const channel of [red, green, blue]) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255)
      throw new TypeError('Expected an 8-bit sRGB channel');
  }
  return 0.2126 * linear[red] + 0.7152 * linear[green] + 0.0722 * linear[blue];
}
