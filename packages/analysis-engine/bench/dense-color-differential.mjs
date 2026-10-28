import assert from 'node:assert/strict';

import { hash, importAnalyzer } from './dense-color-identity.mjs';

/**
 * @param {string} baselineSource
 * @param {string} candidateSource
 */
export async function differential(baselineSource, candidateSource) {
  const { FrameAnalyzer: Baseline } = await importAnalyzer(baselineSource);
  const { FrameAnalyzer: Candidate } = await importAnalyzer(candidateSource);
  const records = [];
  let findings = 0,
    liveEvents = 0,
    packedFrames = 0;
  for (const [w, h] of [
    [1, 1],
    [19, 17],
    [64, 49],
  ])
    for (const mode of [
      'uniform',
      'red',
      'dense',
      'dense-red',
      'alias-fork',
      'alpha-black',
      'source-gap',
    ])
      for (const format of [
        'uint8-aligned',
        'clamped-aligned',
        'mixed-alignment',
      ])
        for (const diagnostics of [true, false]) {
          const key = `${w}x${h}/${mode}/${format}/${diagnostics}`;
          const eventsA =
              /** @type {import("../../core/src/index.js").Finding[]} */ ([]),
            eventsB =
              /** @type {import("../../core/src/index.js").Finding[]} */ ([]);
          /** @type {import("../src/index.js").AnalysisOptions} */
          const options = {
            maxPixels: (w + 1) * h,
            diagnostics,
            visualField: {
              widthPx: 341,
              heightPx: 256,
              basis: 'W3C_CSS_REFERENCE',
              reference: 'Fixed differential field; no display measurement',
            },
          };
          const a = new Baseline({
            ...options,
            onCandidate: (finding) => eventsA.push(structuredClone(finding)),
          });
          const b = new Candidate({
            ...options,
            onCandidate: (finding) => eventsB.push(structuredClone(finding)),
          });
          let calls = 0;
          const dense = b.processDensePacked;
          assert.equal(
            typeof dense,
            'function',
            'Candidate must expose the packed path for execution evidence',
          );
          b.processDensePacked = function (words) {
            calls++;
            return dense.call(this, words);
          };
          for (let frame = 0; frame < 160; frame++) {
            const wNow = w + (mode === 'source-gap' && frame >= 110 ? 1 : 0);
            const offset =
              format === 'mixed-alignment' ? (frame % 3 === 0 ? 1 : 0) : 0;
            const buffer = new ArrayBuffer(wNow * h * 4 + offset);
            const Type =
              format === 'clamped-aligned' ||
              (format === 'mixed-alignment' && frame % 2)
                ? Uint8ClampedArray
                : Uint8Array;
            const rgba = new Type(buffer, offset, wNow * h * 4),
              phase = Math.floor(frame / 5) % 2;
            for (let pixel = 0; pixel < wNow * h; pixel++) {
              const at = pixel * 4;
              let red, green, blue;
              if (
                mode === 'uniform' ||
                (mode === 'alias-fork' && (frame < 35 || frame >= 100))
              )
                red = green = blue = phase ? 230 : 10;
              else if (mode === 'red') {
                red = phase ? 255 : 0;
                green = phase ? 0 : 255;
                blue = 0;
              } else {
                let n = Math.imul(pixel ^ 0x6d2b79f5, 0x45d9f3b);
                n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
                n = (n ^ (n >>> 16)) >>> 0;
                red = (n & 63) + (phase ? 180 : 0);
                green = ((n >>> 8) & 63) + (phase ? 180 : 0);
                blue = ((n >>> 16) & 63) + (phase ? 180 : 0);
                if (mode === 'dense-red' && pixel % 3 === 0) {
                  red = phase ? 230 + (n & 15) : 0;
                  green = phase ? 0 : 230 + ((n >>> 8) & 15);
                  blue = 0;
                }
              }
              if (
                mode === 'alpha-black' &&
                frame >= 75 &&
                frame < 80 &&
                pixel % 7 === 0
              )
                red = green = blue = 0;
              rgba[at] = red;
              rgba[at + 1] = green;
              rgba[at + 2] = blue;
              rgba[at + 3] =
                mode === 'alpha-black' &&
                frame >= 50 &&
                frame < 54 &&
                pixel % 11 === 0
                  ? 120
                  : 255;
            }
            const input = {
              rgba,
              width: wNow,
              height: h,
              timestampMs:
                (frame * 1000) / 60 +
                (mode === 'source-gap' && frame >= 80 ? 140 : 0),
              sourceWidth:
                mode === 'source-gap' && frame >= 90 ? wNow * 2 : wNow,
              sourceHeight: h,
            };
            a.pushFrame(input);
            b.pushFrame(input);
            if (mode === 'source-gap' && frame === 130) {
              a.markInterrupted('Exact comparison interruption');
              b.markInterrupted('Exact comparison interruption');
            }
          }
          const expected = a.finish(),
            actual = b.finish();
          assert.deepEqual(actual, expected, key);
          assert.deepEqual(eventsB, eventsA, `live events ${key}`);
          findings += actual.findings.length;
          liveEvents += eventsB.length;
          packedFrames += calls;
          records.push({
            key,
            packedFrames: calls,
            findings: actual.findings.length,
            liveEvents: eventsB.length,
            resultSha256: hash(JSON.stringify(actual)),
            eventsSha256: hash(JSON.stringify(eventsB)),
          });
        }
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] === 1) {
    assert.ok(packedFrames > 0, 'The optimized path must actually execute');
    for (const format of [
      'uint8-aligned',
      'clamped-aligned',
      'mixed-alignment',
    ])
      assert.ok(
        records.some(
          (record) => record.key.includes(format) && record.packedFrames > 0,
        ),
      );
  }
  return {
    cases: records.length,
    findings,
    liveEvents,
    packedFrames,
    completeResultsIdentical: true,
    liveEventsIdentical: true,
    records,
  };
}
