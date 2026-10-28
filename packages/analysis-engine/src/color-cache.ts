/** Exact, bounded memoization of the existing 8-bit SDR sRGB arithmetic.
 * A hash collision replaces an entry only after checking the complete RGB tag.
 * This never quantizes a colour or shares temporal state between pixels. */
export const linear = Float64Array.from({ length: 256 }, (_, channel) => {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
});

/** Cache exact sRGB conversions without approximating channel values. */
export class ExactSrgbCache {
  private readonly tags = new Uint32Array(4096).fill(0xffffffff);
  readonly luminance = new Float64Array(4096);
  /** Bit zero: saturated red. Bit one: chromaticity has been calculated. */
  readonly flags = new Uint8Array(4096);
  readonly u = new Float64Array(4096);
  readonly v = new Float64Array(4096);
  readonly allocatedBytes =
    this.tags.byteLength +
    this.luminance.byteLength +
    this.flags.byteLength +
    this.u.byteLength +
    this.v.byteLength;

  slot(rgb: number): number {
    const slot = (rgb ^ (rgb >>> 12)) & 4095;
    if (this.tags[slot] !== rgb) {
      const r = linear[rgb & 255],
        g = linear[(rgb >>> 8) & 255],
        b = linear[(rgb >>> 16) & 255];
      this.tags[slot] = rgb;
      this.luminance[slot] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      this.flags[slot] = r / (r + g + b) >= 0.8 ? 1 : 0;
    }
    return slot;
  }

  chromaticity(slot: number, rgb: number): void {
    if (this.flags[slot] & 2) return;
    const r = linear[rgb & 255],
      g = linear[(rgb >>> 8) & 255],
      b = linear[(rgb >>> 16) & 255];
    const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
    const denominator = x + 15 * y + 3 * z;
    this.u[slot] = (4 * x) / denominator;
    this.v[slot] = (9 * y) / denominator;
    this.flags[slot] |= 2;
  }
}
