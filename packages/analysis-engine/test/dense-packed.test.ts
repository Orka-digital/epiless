import type { Finding } from '@epi-less/core';
import { describe, expect, it } from 'vitest';
import { FrameAnalyzer, type AnalysisOptions } from '../src/index.js';

// The byte-offset oracle uses the unchanged byte-reading fallback. The separate
// retained 4a differential proves the direct arithmetic against pre-change code.
describe('dense packed RGBA compatibility', () => {
  it('matches byte-wise input, complete diagnostics and live candidates across resets and history sharing', () => {
    let packedFrames = 0;
    let findings = 0;
    for (const diagnostics of [false, true]) {
      for (const clamped of [false, true]) {
        for (const mode of ['dense', 'red', 'fork', 'alpha-black', 'gap']) {
          const width = 19;
          const height = 17;
          const alignedEvents: Finding[] = [];
          const offsetEvents: Finding[] = [];
          const options: AnalysisOptions = {
            maxPixels: width * height,
            diagnostics,
            visualField: {
              widthPx: 13,
              heightPx: 11,
              basis: 'W3C_CSS_REFERENCE',
              reference: 'Explicit numeric test field; no display measurement.',
            },
          };
          const aligned = new FrameAnalyzer({
            ...options,
            onCandidate: (finding) =>
              alignedEvents.push(structuredClone(finding)),
          });
          const offset = new FrameAnalyzer({
            ...options,
            onCandidate: (finding) =>
              offsetEvents.push(structuredClone(finding)),
          });
          type PackedAccess = {
            processDensePacked: (words: Uint32Array) => void;
          };
          const access = aligned as unknown as PackedAccess;
          const original = access.processDensePacked.bind(aligned);
          access.processDensePacked = (words) => {
            packedFrames++;
            original(words);
          };
          (offset as unknown as PackedAccess).processDensePacked = () => {
            throw new Error('An unaligned byte view cannot use packed words');
          };
          for (let frame = 0; frame < 140; frame++) {
            const Type = clamped ? Uint8ClampedArray : Uint8Array;
            const rgba = new Type(width * height * 4);
            const phase = Math.floor(frame / 5) % 2;
            for (let pixel = 0; pixel < width * height; pixel++) {
              const i = pixel * 4;
              const unique = ((pixel * 37) ^ (pixel >>> 2)) & 63;
              const uniform = mode === 'fork' && (frame < 35 || frame >= 100);
              const value = (uniform ? 10 : unique) + phase * 180;
              rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
              if (mode === 'red' && pixel % 3 === 0) {
                rgba[i] = phase ? 255 : 0;
                rgba[i + 1] = phase ? 0 : 255;
                rgba[i + 2] = 0;
              }
              if (mode === 'alpha-black' && frame >= 75 && frame < 80) {
                rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
              }
              rgba[i + 3] =
                mode === 'alpha-black' && frame >= 50 && frame < 54 ? 120 : 255;
            }
            const byteOffset = new Type(
              new ArrayBuffer(rgba.byteLength + 1),
              1,
            );
            byteOffset.set(rgba);
            const input = {
              width,
              height,
              timestampMs:
                (frame * 1000) / 60 + (mode === 'gap' && frame >= 80 ? 140 : 0),
              sourceWidth: mode === 'gap' && frame >= 100 ? width * 2 : width,
              sourceHeight: height,
            };
            aligned.pushFrame({ ...input, rgba });
            offset.pushFrame({ ...input, rgba: byteOffset });
            if (mode === 'gap' && frame === 120) {
              aligned.markInterrupted('Explicit test interruption');
              offset.markInterrupted('Explicit test interruption');
            }
          }
          const result = aligned.finish();
          expect(result, `${mode}/${clamped}/${diagnostics}`).toEqual(
            offset.finish(),
          );
          expect(alignedEvents).toEqual(offsetEvents);
          findings += result.findings.length;
        }
      }
    }
    expect(findings).toBeGreaterThan(0);
    if (new Uint8Array(new Uint32Array([1]).buffer)[0] === 1) {
      expect(packedFrames).toBeGreaterThan(0);
    }
  });
});
