import { describe, expect, it } from 'vitest';

import { FrameAnalyzer } from '../src/index.js';

import { exactTranslation } from '../src/spatial.js';

import { field, rgbaImage } from './spatial.fixture';
describe('bounded motion and fine-pattern evidence', () => {
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
