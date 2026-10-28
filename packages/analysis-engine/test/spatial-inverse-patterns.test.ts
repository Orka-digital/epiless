import { describe, expect, it } from 'vitest';

import { FrameAnalyzer } from '../src/index.js';

import {
  balancedCheckerboard,
  exactCheckerboardInverse,
} from '../src/spatial.js';

import { field, rgbaImage } from './spatial.fixture';
describe('bounded motion and fine-pattern evidence', () => {
  it('uses 10° horizontally and 7.5° vertically for the strict 0.1° cell test', () => {
    const image = rgbaImage(24, 24, (x, y) =>
      (Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? 255 : 0,
    );
    const region = { x: 0, y: 0, width: 24, height: 24 };
    // In the W3C reference, 3 pixels are ~0.088° on either axis.
    expect(
      balancedCheckerboard(image, 24, region, {
        ...field,
        basis: 'W3C_1024_768_REFERENCE',
        widthPx: 341,
        heightPx: 256,
      }),
    ).toMatchObject({
      belowPointOneDegree: true,
      automaticallyExcluded: false,
    });
    for (const [widthPx, heightPx, expected] of [
      [400, 225, false],
      [400, 226, true],
      [300, 300, false],
      [301, 300, true],
    ] as const)
      expect(
        balancedCheckerboard(image, 24, region, { ...field, widthPx, heightPx })
          .belowPointOneDegree,
      ).toBe(expected);
    expect(
      balancedCheckerboard(image, 24, region).belowPointOneDegree,
    ).toBeUndefined();
  });

  it('recognizes an exact balanced checkerboard but never silently exempts it', () => {
    const image = rgbaImage(32, 24, (x, y) =>
      (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 255 : 0,
    );
    const detected = balancedCheckerboard(
      image,
      32,
      { x: 0, y: 0, width: 32, height: 24 },
      { ...field, widthPx: 341, heightPx: 256 },
    );
    expect(detected).toEqual({
      kind: 'EXACT_BALANCED_CHECKERBOARD',
      cellWidthPx: 2,
      cellHeightPx: 2,
      belowPointOneDegree: true,
      automaticallyExcluded: false,
    });
    image[4] = 120;
    expect(
      balancedCheckerboard(image, 32, { x: 0, y: 0, width: 32, height: 24 })
        .kind,
    ).toBe('NONE_DEMONSTRATED');
  });

  it('requires the same two opaque colours to swap at every pixel of the same frame pair', () => {
    const region = { x: 0, y: 0, width: 32, height: 24 };
    const first = rgbaImage(32, 24, (x, y) => ((x + y) % 2 ? 220 : 20));
    const inverse = rgbaImage(32, 24, (x, y) => ((x + y) % 2 ? 20 : 220));
    const previous = new Uint32Array(first.buffer);
    expect(
      exactCheckerboardInverse(inverse, previous, 32, region, 680, 700),
    ).toEqual({
      kind: 'EXACT_TWO_FRAME_INVERSE',
      previousSampledAtMs: 680,
      currentSampledAtMs: 700,
      comparedPixels: 768,
      firstColorPixels: 384,
      secondColorPixels: 384,
    });
    // Equal areas in each image alone do not establish inverse temporal phase.
    const brighter = rgbaImage(32, 24, (x, y) => ((x + y) % 2 ? 240 : 40));
    expect(balancedCheckerboard(brighter, 32, region).kind).toBe(
      'EXACT_BALANCED_CHECKERBOARD',
    );
    expect(
      exactCheckerboardInverse(brighter, previous, 32, region, 680, 700),
    ).toBeUndefined();
    expect(
      exactCheckerboardInverse(first, previous, 32, region, 680, 700),
    ).toBeUndefined();
    const contradicted = inverse.slice();
    contradicted[(13 * 32 + 17) * 4] ^= 1;
    expect(
      exactCheckerboardInverse(contradicted, previous, 32, region, 680, 700),
    ).toBeUndefined();
    const transparent = inverse.slice();
    transparent[(13 * 32 + 17) * 4 + 3] = 254;
    expect(
      exactCheckerboardInverse(transparent, previous, 32, region, 680, 700),
    ).toBeUndefined();
    for (const previousTime of [undefined, NaN, -1, 700, 701])
      expect(
        exactCheckerboardInverse(
          inverse,
          previous,
          32,
          region,
          previousTime,
          700,
        ),
      ).toBeUndefined();
    expect(
      exactCheckerboardInverse(
        inverse,
        previous.subarray(1),
        32,
        region,
        680,
        700,
      ),
    ).toBeUndefined();
  });

  it('retains the actual strongest frame pair, including identical accepted frames, without suppressing candidates', () => {
    for (const diagnostics of [true, false]) {
      const analyzer = new FrameAnalyzer({ diagnostics });
      for (let t = 0; t <= 1200; t += 20)
        analyzer.pushFrame({
          rgba: rgbaImage(32, 24, (x, y) =>
            (x + y + Math.floor(t / 100)) % 2 ? 220 : 20,
          ),
          width: 32,
          height: 24,
          timestampMs: t,
        });
      const result = analyzer.finish();
      expect(result.findings.length).toBeGreaterThan(0);
      const spatial = result.findings[0].spatial!;
      expect(spatial.pattern.inversePhase).toEqual({
        kind: 'EXACT_TWO_FRAME_INVERSE',
        previousSampledAtMs: spatial.sampledAtMs - 20,
        currentSampledAtMs: spatial.sampledAtMs,
        comparedPixels: 768,
        firstColorPixels: 384,
        secondColorPixels: 384,
      });
      expect(spatial.sampledAtMs).toBe(700);
      expect(result.findings[0].endMs).toBeGreaterThan(700);
      expect(spatial.pattern.automaticallyExcluded).toBe(false);
    }
  });
});
