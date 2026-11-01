import { describe, expect, it } from 'vitest';

import {
  combinedMaskFieldAnalysis,
  visualFieldFromDisplay,
} from '../src/index.js';

describe('independently formulated spatial masks', () => {
  it('matches exhaustive window sums across deterministic irregular masks', () => {
    let random = 0x791315;
    for (let sample = 0; sample < 120; sample++) {
      const w = 3 + (sample % 14),
        h = 2 + (sample % 9),
        fw = 1 + (sample % 19),
        fh = 1 + (sample % 13);
      const mask = Uint8Array.from({ length: w * h }, () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random % 7 < 3 ? 1 : 0;
      });
      let expected = 0;
      // Deliberately independent brute-force sum, including windows beyond edges.
      for (let top = -fh; top <= h; top++)
        for (let left = -fw; left <= w; left++) {
          let sum = 0;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
              if (x >= left && x < left + fw && y >= top && y < top + fh)
                sum += mask[y * w + x];
          expected = Math.max(expected, sum);
        }
      const actual = combinedMaskFieldAnalysis(mask, w, h, fw, fh);
      expect(actual.maximumPixels).toBe(expected);
      expect(actual.exceedsThreshold).toBe(expected > (fw * fh) / 4);
      expect(actual.totalPixels).toBe(mask.reduce((a, b) => a + b, 0));
    }
  });

  it('combines disconnected simultaneous islands and preserves the exact cutoff', () => {
    const mask = new Uint8Array(200);
    for (let y = 0; y < 4; y++)
      for (const x of [0, 1, 2, 3, 6, 7, 8, 9]) mask[y * 20 + x] = 1;
    expect(combinedMaskFieldAnalysis(mask, 20, 10, 10, 10)).toMatchObject({
      totalPixels: 32,
      maximumPixels: 32,
      exceedsThreshold: true,
    });
    const exact = Uint8Array.from({ length: 100 }, (_, i) => (i < 25 ? 1 : 0));
    expect(
      combinedMaskFieldAnalysis(exact, 10, 10, 10, 10).exceedsThreshold,
    ).toBe(false);
    exact[25] = 1;
    expect(
      combinedMaskFieldAnalysis(exact, 10, 10, 10, 10).exceedsThreshold,
    ).toBe(true);
    expect(() =>
      combinedMaskFieldAnalysis(new Uint8Array([2]), 1, 1, 1, 1),
    ).toThrow();
  });

  it('requires explicit geometry and keeps numeric physical assumptions visible', () => {
    expect(() =>
      visualFieldFromDisplay({
        screenWidthPx: 1920,
        screenHeightPx: 1080,
        screenWidthMm: 0,
        screenHeightMm: 300,
        viewingDistanceMm: 600,
      }),
    ).toThrow();
    const a = visualFieldFromDisplay({
      screenWidthPx: 1920,
      screenHeightPx: 1080,
      screenWidthMm: 530,
      screenHeightMm: 300,
      viewingDistanceMm: 600,
    });
    expect(a.basis).toBe('EXPLICIT_CALIBRATION');
    expect(a.reference).toContain('600 mm');
    // Published G176 factors give 104.7 × 78.54 mm. Independent dimensional
    // arithmetic gives 379.290566... × 282.744 source pixels, not a square.
    expect(a.widthPx).toBe(379);
    expect(a.heightPx).toBe(283);
    expect(a.reference).toContain('10 by 7.5 degrees');
    expect(a.reference).toContain('Not an exact solid-angle');
    const mask = new Uint8Array(400 * 400);
    for (let y = 0; y < 100; y++) mask.fill(1, y * 400, y * 400 + 300);
    expect(
      combinedMaskFieldAnalysis(mask, 400, 400, a.widthPx, a.heightPx),
    ).toMatchObject({ maximumPixels: 30_000, exceedsThreshold: true });
    // The previous 10°×10° estimate (380×378 at these physical inputs)
    // incorrectly gave this same 30,000-pixel mask a below-threshold result.
    expect(
      combinedMaskFieldAnalysis(mask, 400, 400, 380, 378).exceedsThreshold,
    ).toBe(false);
  });

  it('reproduces the 17-inch known-display example and makes pixel rounding explicit', () => {
    // A 17-inch 4:3 panel is 345.44×259.08 mm. At 660 mm the published
    // approximation spans 341.4025...×256.1008... pixels at 1024×768.
    expect(
      visualFieldFromDisplay({
        screenWidthPx: 1024,
        screenHeightPx: 768,
        screenWidthMm: 345.44,
        screenHeightMm: 259.08,
        viewingDistanceMm: 660,
      }),
    ).toMatchObject({ widthPx: 341, heightPx: 256 });
    const doubled = visualFieldFromDisplay({
      screenWidthPx: 3840,
      screenHeightPx: 2160,
      screenWidthMm: 530,
      screenHeightMm: 300,
      viewingDistanceMm: 600,
    });
    expect(doubled).toMatchObject({ widthPx: 759, heightPx: 565 });
    expect(doubled.reference).toContain('rounded to nearest source pixel');
    // Deliberately non-square pixel pitch: apply each physical axis separately.
    expect(
      visualFieldFromDisplay({
        screenWidthPx: 2000,
        screenHeightPx: 1000,
        screenWidthMm: 1000,
        screenHeightMm: 1000,
        viewingDistanceMm: 100,
      }),
    ).toMatchObject({ widthPx: 35, heightPx: 13 });
    for (const invalid of [
      { screenWidthPx: 1920.5 },
      { screenHeightPx: 1080.5 },
      { viewingDistanceMm: 0 },
      { viewingDistanceMm: Infinity },
      { screenWidthMm: NaN },
      { viewingDistanceMm: 0.001 },
    ])
      expect(() =>
        visualFieldFromDisplay({
          screenWidthPx: 1920,
          screenHeightPx: 1080,
          screenWidthMm: 530,
          screenHeightMm: 300,
          viewingDistanceMm: 600,
          ...invalid,
        }),
      ).toThrow();
  });
});
