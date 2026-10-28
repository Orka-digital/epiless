import { describe, expect, it } from 'vitest';

import { FrameAnalyzer } from '../src/index.js';

import { field, rgbaImage } from './spatial.fixture';
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
});
