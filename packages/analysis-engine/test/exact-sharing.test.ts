import { describe, expect, it } from 'vitest';
import { FrameAnalyzer } from '../src/index.js';
import { ExactSrgbCache } from '../src/color-cache.js';
import { DiagnosticHistory } from '../src/diagnostic-history.js';
import { exactTranslation } from '../src/spatial.js';

describe('exact shared-state differential', () => {
  it('keeps full uniform masks exact before and after a single pixel forks its history', () => {
    for (const [width, height] of [
      [16, 16],
      [19, 17],
      [1, 1],
    ]) {
      const shared = new FrameAnalyzer(),
        dense = new FrameAnalyzer();
      (dense as unknown as { prepareTiles: () => void }).prepareTiles =
        () => {};
      for (let frame = 0; frame < 132; frame++) {
        const rgba = new Uint8Array(width * height * 4);
        for (let pixel = 0; pixel < width * height; pixel++) {
          const value =
            frame >= 50 &&
            frame < 90 &&
            pixel === Math.floor((width * height) / 2)
              ? 60
              : Math.floor(frame / 5) % 2
                ? 255
                : 0;
          rgba[pixel * 4] = rgba[pixel * 4 + 1] = rgba[pixel * 4 + 2] = value;
          rgba[pixel * 4 + 3] = 255;
        }
        const input = { rgba, width, height, timestampMs: (frame * 1000) / 60 };
        shared.pushFrame(input);
        dense.pushFrame(input);
      }
      const actual = shared.finish(),
        expected = dense.finish();
      expect(actual).toEqual(expected);
      expect(actual.findings[0].spatial?.componentPixels).toBe(width * height);
    }
  });
  it('matches independent dense pixel histories through seeded splitting, identical later images, alpha, gaps and partial tiles', () => {
    for (const diagnostics of [true, false])
      for (let seed = 1; seed <= 8; seed++) {
        const width = seed % 2 ? 63 : 64,
          height = seed % 3 ? 41 : 48;
        const shared = new FrameAnalyzer({ diagnostics });
        const dense = new FrameAnalyzer({ diagnostics });
        // Differential oracle runs the same temporal rules independently for each
        // original source pixel. It never shares, forks or coalesces any state.
        (dense as unknown as { prepareTiles: () => void }).prepareTiles =
          () => {};
        for (let frame = 0; frame < 135; frame++) {
          const rgba = new Uint8Array(width * height * 4),
            phase = Math.floor(frame / 5) % 2;
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const p = y * width + x,
                i = p * 4;
              let value =
                (((x % 8) * 13 + (y % 8) * 7 + seed * 11) % 65) + phase * 170;
              // Canonical and noncanonical peers diverge at different moments;
              // later equal colours must not erase their different prior histories.
              if (frame >= 31 && frame < 67 && x < 8 && y < 8) value = 60;
              if (
                frame >= 36 &&
                frame < 74 &&
                x >= 24 &&
                x < 32 &&
                y >= 16 &&
                y < 24
              )
                value = 120;
              if (frame >= 70 && frame < 83 && x === 18 && y === 18) value = 30;
              rgba[i] = value;
              rgba[i + 1] = value;
              rgba[i + 2] = value;
              rgba[i + 3] = 255;
              if (((x % 8) + (y % 8) + seed) % 3 === 0) {
                rgba[i] = phase ? 255 : 0;
                rgba[i + 1] = phase ? 0 : 255;
                rgba[i + 2] = 0;
              }
              if (frame === 58 && x === 25 && y === 17) rgba[i + 3] = 0;
            }
          const captured = {
            rgba,
            width,
            height,
            timestampMs: (frame * 1000) / 60 + (frame >= 103 ? 250 : 0),
            sourceWidth: frame >= 93 ? width + 1 : width,
            sourceHeight: height,
          };
          shared.pushFrame(captured);
          dense.pushFrame(captured);
        }
        const actual = shared.finish(),
          expected = dense.finish();
        expect(actual.findings).toEqual(expected.findings);
        expect(actual.status).toBe(expected.status);
        expect(actual.quality).toEqual(expected.quality);
        expect(actual.limitations).toEqual(expected.limitations);
        expect(actual.findings.length).toBeGreaterThan(0);
      }
  });
});

describe('exact bounded RGB memoization', () => {
  it('retains unquantized arithmetic through cache collisions and evictions', () => {
    const cache = new ExactSrgbCache();
    let random = 0x1a7f39;
    const colors = [
      0, 0xffffff, 0x0000ff, 0x00ff00, 0xff0000, 0x000001, 0x001000,
    ];
    for (let i = 0; i < 12000; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      colors.push(random & 0xffffff);
    }
    const decode = (n: number) =>
      n / 255 <= 0.04045 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4;
    for (const rgb of [...colors, ...colors.reverse()]) {
      const slot = cache.slot(rgb),
        r = decode(rgb & 255),
        g = decode((rgb >>> 8) & 255),
        b = decode(rgb >>> 16);
      expect(cache.luminance[slot]).toBe(0.2126 * r + 0.7152 * g + 0.0722 * b);
      expect(!!(cache.flags[slot] & 1)).toBe(r / (r + g + b) >= 0.8);
      cache.chromaticity(slot, rgb);
      const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
        y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b,
        z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b,
        d = x + 15 * y + 3 * z;
      expect(cache.u[slot]).toBe((4 * x) / d);
      expect(cache.v[slot]).toBe((9 * y) / d);
    }
    expect(cache.allocatedBytes).toBeLessThan(128 * 1024);
  });
});

describe('changed-pixel motion rejection', () => {
  it('agrees with exhaustive overlap verification when changes lie outside some shifted overlaps', () => {
    const width = 64,
      height = 48;
    const previous = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      previous[p * 4] = p % 256;
      previous[p * 4 + 1] = (p + 71) % 256;
      previous[p * 4 + 2] = (p + 133) % 256;
      previous[p * 4 + 3] = 255;
    }
    for (const point of [
      0,
      width - 1,
      (height - 1) * width,
      width * height - 1,
      22 * width + 31,
    ]) {
      const current = previous.slice();
      current.fill(255, point * 4, point * 4 + 4);
      const history = new DiagnosticHistory(width, height),
        words = new Uint32Array(previous.buffer);
      history.push(previous, 0);
      history.push(current, 20, words);
      expect(history.changedRuns).toBeDefined();
      expect(
        exactTranslation(current, words, width, height, history.changedRuns),
      ).toEqual(exactTranslation(current, words, width, height));
    }
  });
});
