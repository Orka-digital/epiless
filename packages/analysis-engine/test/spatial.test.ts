import { describe, expect, it } from 'vitest';
import {
  FrameAnalyzer,
  combinedMaskFieldAnalysis,
  visualFieldFromDisplay,
} from '../src/index.js';
import {
  balancedCheckerboard,
  exactTranslation,
  exactCheckerboardInverse,
} from '../src/spatial.js';
import { DiagnosticHistory } from '../src/diagnostic-history.js';

function rgbaImage(
  w: number,
  h: number,
  color: (x: number, y: number) => number,
): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4,
        v = color(x, y);
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  return rgba;
}
const field = {
  widthPx: 10,
  heightPx: 10,
  basis: 'EXPLICIT_CALIBRATION' as const,
  reference: 'Synthetic integer field; no display assertion',
};

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

describe('native detail and exact temporal state sharing', () => {
  it('reserves state without inventing source frames, timestamps or findings', () => {
    const empty = new FrameAnalyzer();
    empty.prepare(64, 64);
    empty.prepare(64, 64);
    const noFrames = empty.finish();
    expect(noFrames.quality.frameCount).toBe(0);
    expect(noFrames.findings).toEqual([]);
    expect(noFrames.status).toBe('INCONCLUSIVE');
    expect(() => empty.prepare(64, 64)).toThrow();
    const events: unknown[] = [];
    const prepared = new FrameAnalyzer({ onCandidate: (f) => events.push(f) });
    prepared.prepare(64, 64);
    expect(events).toEqual([]);
    prepared.pushFrame({
      rgba: rgbaImage(64, 64, () => 100),
      width: 64,
      height: 64,
      timestampMs: 9000,
    });
    expect(() => prepared.prepare(64, 64)).toThrow();
    const result = prepared.finish();
    expect(result.quality.frameCount).toBe(1);
    expect(result.findings).toEqual([]);
    expect(events).toEqual([]);
    const invalid = new FrameAnalyzer();
    for (const [w, h] of [
      [0, 1],
      [1.5, 1],
      [1000, 1000],
    ])
      expect(() => invalid.prepare(w, h)).toThrow();
  });
  it('preserves a single native 1080p source pixel and a complete numeric trace', () => {
    const w = 1920,
      h = 1080,
      p = (h - 2) * w + w - 2;
    const a = new FrameAnalyzer({ maxPixels: w * h });
    const image = rgbaImage(w, h, () => 100);
    for (let f = 0; f < 76; f++) {
      const v = Math.floor(f / 6) % 2 ? 255 : 0;
      image[p * 4] = image[p * 4 + 1] = image[p * 4 + 2] = v;
      a.pushFrame({
        rgba: image,
        width: w,
        height: h,
        timestampMs: (f * 1000) / 60,
      });
    }
    const result = a.finish();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      region: { x: w - 2, y: h - 2, width: 1, height: 1 },
      spatial: { componentPixels: 1, simultaneousPixels: 1 },
      diagnostic: { point: { x: w - 2, y: h - 2 }, complete: true },
    });
    expect(result.quality).toMatchObject({
      downsampled: false,
      spatial: {
        mode: 'NATIVE_PIXELS',
        retainedResolutionRatio: 1,
        tileSharing: 'LOSSLESS_IDENTICAL_HISTORY',
      },
    });
    expect(result.quality.spatial!.stateBytes).toBeLessThan(256 * 1024 * 1024);
    expect(result.findings[0].diagnostic!.samples.length).toBeGreaterThan(40);
    expect(result.passed).toBeNull();
  }, 15_000);
  it('forks a formerly uniform tile without forgetting the first six transitions', () => {
    const w = 8,
      h = 8,
      a = new FrameAnalyzer();
    for (let t = 0; t <= 1200; t += 20) {
      const image = rgbaImage(w, h, (x, y) =>
        x === 4 && y === 5
          ? Math.floor(t / 100) % 2
            ? 255
            : 0
          : t < 600
            ? Math.floor(t / 100) % 2
              ? 255
              : 0
            : 0,
      );
      a.pushFrame({ rgba: image, width: w, height: h, timestampMs: t });
    }
    const findings = a.finish().findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      startMs: 100,
      region: { x: 4, y: 5, width: 1, height: 1 },
    });
    expect(findings[0].diagnostic!.windowEndMs).toBe(700);
  });
  it('attaches the sum of disjoint regions to each same-frame candidate', () => {
    const a = new FrameAnalyzer({ visualField: field });
    for (let t = 0; t <= 1200; t += 20) {
      const image = rgbaImage(20, 10, (x, y) =>
        y < 4 && (x < 4 || (x >= 6 && x < 10))
          ? Math.floor(t / 100) % 2
            ? 255
            : 0
          : 100,
      );
      a.pushFrame({ rgba: image, width: 20, height: 10, timestampMs: t });
    }
    const findings = a.finish().findings;
    expect(findings).toHaveLength(2);
    for (const f of findings)
      expect(f.spatial).toMatchObject({
        componentPixels: 16,
        simultaneousPixels: 32,
        visualField: {
          maximumPixels: 32,
          maximumRatio: 0.32,
          exceedsThreshold: true,
        },
      });
  });
  it('does not unite asynchronous regions into a fictitious simultaneous mask', () => {
    const a = new FrameAnalyzer({ visualField: field });
    for (let t = 0; t <= 1200; t += 20) {
      const image = rgbaImage(20, 10, (x, y) =>
        y < 4 && x < 4
          ? Math.floor(t / 100) % 2
            ? 255
            : 0
          : y < 4 && x >= 6 && x < 10
            ? Math.floor((t + 40) / 100) % 2
              ? 255
              : 0
            : 100,
      );
      a.pushFrame({ rgba: image, width: 20, height: 10, timestampMs: t });
    }
    const findings = a.finish().findings;
    expect(findings).toHaveLength(2);
    for (const f of findings)
      expect(f.spatial).toMatchObject({
        simultaneousPixels: 16,
        visualField: { maximumPixels: 16, exceedsThreshold: false },
      });
  });
  it('retains a later simultaneous field maximum while first detection and source events keep their original time', () => {
    const firstDetections: ReturnType<FrameAnalyzer['finish']>['findings'] = [];
    const a = new FrameAnalyzer({
      visualField: { ...field, widthPx: 4, heightPx: 3 },
      onCandidate: (finding) => firstDetections.push(finding),
    });
    let left = 0,
      right = 0;
    for (let t = 0; t <= 1200; t += 25) {
      if (t >= 100 && t <= 700 && t % 100 === 0) left = 255 - left;
      if (t >= 150 && t <= 750 && t % 100 === 50) right = 255 - right;
      // Both already-reported components now transition on the same frame.
      if (t === 850) {
        left = 255 - left;
        right = 255 - right;
      }
      a.pushFrame({
        rgba: rgbaImage(4, 3, (x, y) =>
          y < 2 && x === 0 ? left : y < 2 && x === 3 ? right : 100,
        ),
        width: 4,
        height: 3,
        timestampMs: t,
      });
    }
    expect(firstDetections).toHaveLength(2);
    expect(firstDetections.map((f) => f.spatial!.sampledAtMs)).toEqual([
      700, 750,
    ]);
    for (const first of firstDetections)
      expect(first.spatial).toMatchObject({
        simultaneousPixels: 2,
        visualField: { maximumPixels: 2, exceedsThreshold: false },
      });
    const findings = a.finish().findings;
    expect(findings).toHaveLength(2);
    for (const [i, finding] of findings.entries()) {
      expect(finding.endMs).toBe(850);
      expect(finding.diagnostic).toEqual(firstDetections[i]!.diagnostic);
      expect(finding.spatial).toMatchObject({
        sampledAtMs: 850,
        componentPixels: 2,
        simultaneousPixels: 4,
        simultaneousRatio: 4 / 12,
        visualField: {
          maximumPixels: 4,
          maximumRatio: 4 / 12,
          exceedsThreshold: true,
        },
      });
    }
  });
  it('does not attach a calibrated field after rescaling and clears history on source changes', () => {
    const a = new FrameAnalyzer({ visualField: field });
    for (let t = 0; t <= 1200; t += 20)
      a.pushFrame({
        rgba: rgbaImage(20, 10, () => (Math.floor(t / 100) % 2 ? 255 : 0)),
        width: 20,
        height: 10,
        sourceWidth: 40,
        sourceHeight: 20,
        timestampMs: t,
      });
    const result = a.finish();
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.findings[0].spatial!.visualField).toBeUndefined();
  });
});

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
  it('invalidates the previous-frame clock across gap, interruption, geometry and temporal epoch reset', () => {
    type Access = { previousFrameAtMs: number | undefined; frameIndex: number };
    for (const reason of [
      'gap',
      'interrupt',
      'geometry',
      'source',
      'epoch',
      'invalid',
    ] as const) {
      const analyzer = new FrameAnalyzer();
      analyzer.pushFrame({
        rgba: rgbaImage(8, 8, () => 10),
        width: 8,
        height: 8,
        timestampMs: 0,
      });
      const access = analyzer as unknown as Access;
      expect(access.previousFrameAtMs).toBe(0);
      if (reason === 'interrupt') {
        analyzer.markInterrupted();
        expect(access.previousFrameAtMs).toBeUndefined();
      }
      if (reason === 'epoch') access.frameIndex = 65535;
      if (reason === 'invalid') {
        analyzer.pushFrame({
          rgba: new Uint8Array(0),
          width: 8,
          height: 8,
          timestampMs: 20,
        });
        expect(access.previousFrameAtMs).toBeUndefined();
      }
      const time = reason === 'gap' ? 400 : 40;
      const width = reason === 'geometry' ? 10 : 8;
      analyzer.pushFrame({
        rgba: rgbaImage(width, 8, (x, y) => ((x + y) % 2 ? 220 : 20)),
        width,
        height: 8,
        sourceWidth: reason === 'source' ? 16 : width,
        timestampMs: time,
      });
      expect(access.previousFrameAtMs).toBe(time);
      // A new epoch cannot report a transition or attach a cross-boundary pair.
      expect(analyzer.finish().findings).toEqual([]);
    }
  });
  it('verifies the whole translated overlap, rejecting a single unsampled contradiction', () => {
    const w = 96,
      h = 64;
    const previous = rgbaImage(w, h, (x, y) => (x * 13 + y * 29) % 256);
    const current = rgbaImage(w, h, (x, y) =>
      x < 2 ? 0 : ((x - 2) * 13 + y * 29) % 256,
    );
    const words = new Uint32Array(previous.buffer);
    expect(exactTranslation(current, words, w, h)).toMatchObject({
      kind: 'EXACT_TRANSLATION_COMPATIBLE',
      dx: 2,
      dy: 0,
      comparedPixels: 94 * 64,
      automaticallyExcluded: false,
    });
    current[(17 * w + 23) * 4] ^= 1;
    expect(exactTranslation(current, words, w, h).kind).toBe(
      'NONE_DEMONSTRATED',
    );
    expect(exactTranslation(previous, words, w, h).kind).toBe(
      'NONE_DEMONSTRATED',
    );
  });
  it('retains periodic moving-pattern candidates with ambiguity, not a movement exemption', () => {
    const a = new FrameAnalyzer({
      visualField: { ...field, widthPx: 341, heightPx: 256 },
    });
    for (let t = 0; t <= 1200; t += 20)
      a.pushFrame({
        rgba: rgbaImage(32, 24, (x, y) =>
          (Math.floor((x + Math.floor(t / 100) * 2) / 2) + Math.floor(y / 2)) %
          2
            ? 255
            : 0,
        ),
        width: 32,
        height: 24,
        timestampMs: t,
      });
    expect(a.finish().findings[0].spatial).toMatchObject({
      pattern: {
        kind: 'EXACT_BALANCED_CHECKERBOARD',
        automaticallyExcluded: false,
      },
      motion: {
        kind: 'EXACT_TRANSLATION_COMPATIBLE',
        automaticallyExcluded: false,
      },
    });
  });
});

describe('lossless volatile diagnostic history', () => {
  it('reconstructs pixel traces through delta eviction and raw fallbacks', () => {
    const w = 47,
      h = 29,
      history = new DiagnosticHistory(w, h);
    let previous: Uint32Array | undefined;
    const expected: number[] = [];
    for (let f = 0; f < 120; f++) {
      const image = rgbaImage(w, h, (x, y) =>
        f < 50
          ? x === 17 && y === 13
            ? f
            : 100
          : (x * 7 + y * 11 + f * 3) % 256,
      );
      expected.push(image[(13 * w + 17) * 4]);
      history.push(image, f * 20, previous);
      previous = new Uint32Array(image.buffer).slice();
    }
    const trace = history.evidence(13 * w + 17, 1000, 2380, w, h);
    expect(trace.samples).toHaveLength(96);
    expect(trace.samples.map((s) => s.red)).toEqual(expected.slice(-96));
    expect(trace.samples[0].timestampMs).toBe(480);
    expect(trace.complete).toBe(true);
  });
});
