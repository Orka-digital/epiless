import { describe, expect, it } from 'vitest';

import { DiagnosticHistory } from '../src/diagnostic-history.js';
import { rgbaImage } from './spatial.fixture';
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
