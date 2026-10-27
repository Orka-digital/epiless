import { describe, expect, it } from 'vitest';
import {
  captureDimensions,
  NATIVE_PIXEL_BUDGET,
  validateCaptureViewport,
} from '../../apps/chrome-extension/src/capture-quality';

describe('native capture budget', () => {
  it('preserves every source pixel at desktop and mobile sizes within budget', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1280, 720],
      [390, 844],
      [1080, 1920],
      [2560, 720],
    ])
      expect(captureDimensions(width, height)).toEqual({ width, height });
  });
  it('bounds oversized 2xDPR frames without hiding their required rescaling', () => {
    const source = { width: 3840, height: 2160 };
    const reduced = captureDimensions(source.width, source.height);
    expect(reduced).toEqual({ width: 1920, height: 1080 });
    for (const [w, h] of [
      [3000, 2000],
      [16384, 16384],
      [16384, 500],
    ]) {
      const reduced = captureDimensions(w, h);
      expect(reduced.width * reduced.height).toBeLessThanOrEqual(
        NATIVE_PIXEL_BUDGET,
      );
      expect(reduced.width).toBeLessThan(w);
      expect(reduced.height).toBeLessThan(h);
    }
  });
  it('rejects invalid source dimensions before allocating a capture canvas', () => {
    for (const v of [0, -1, 1.5, NaN, Infinity, 16385])
      expect(() => captureDimensions(v, 1080)).toThrow();
  });
  it('validates a concrete CSS viewport and its rounded source-pixel geometry', () => {
    expect(
      validateCaptureViewport({ width: 900, height: 563, dpr: 2 }),
    ).toEqual({ width: 900, height: 563, dpr: 2 });
    for (const input of [
      null,
      {},
      { width: 0, height: 563, dpr: 2 },
      { width: 900.1, height: 563, dpr: 2 },
      { width: 900, height: 563, dpr: NaN },
      { width: 1, height: 1, dpr: 0.1 },
      { width: 9000, height: 563, dpr: 2 },
    ])
      expect(() => validateCaptureViewport(input)).toThrow(
        'Invalid expected capture viewport',
      );
  });
});
