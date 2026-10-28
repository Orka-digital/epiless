import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { observeFrozenSpatial } from './spatial-witness.mjs';
import { assertState } from './state-comparison.mjs';

const hash = (/** @type {import('node:crypto').BinaryLike} */ value) =>
  createHash('sha256').update(value).digest('hex');
/** Run one exact three-engine case without rendering numeric frames.
 * @param {{w:number,h:number,mode:string,format:string,diagnostics:boolean}} scenario
 * @param {{Baseline:import('./probe-types.js').EngineModule['FrameAnalyzer'],Packed:import('./probe-types.js').EngineModule['FrameAnalyzer'],frozenCheckerboard:import('./probe-types.js').Checkerboard,EMBEDDED_KERNEL_BYTES:number}} engines
 */
export function runDenseCase(
  { w, h, mode, format, diagnostics },
  { Baseline, Packed, frozenCheckerboard, EMBEDDED_KERNEL_BYTES },
) {
  let findings = 0,
    liveEvents = 0,
    packedFrames = 0,
    stateChecks = 0,
    currentStateChecks = 0,
    mixedSharedFrames = 0;
  const key = `${w}x${h}/${mode}/${format}/${diagnostics}`;
  const eventsA =
      /** @type {import("../../core/src/index.js").Finding[]} */ ([]),
    eventsB = /** @type {import("../../core/src/index.js").Finding[]} */ ([]),
    eventsJs = /** @type {import("../../core/src/index.js").Finding[]} */ ([]);
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
    onCandidate: (f) => eventsA.push(structuredClone(f)),
  });
  const b = new Packed({
    ...options,
    onCandidate: (f) => eventsB.push(structuredClone(f)),
  });
  const js = new Packed({
    ...options,
    backend: 'JS',
    onCandidate: (f) => eventsJs.push(structuredClone(f)),
  });
  const spatialWitness = observeFrozenSpatial(a, frozenCheckerboard);
  const compare = (/** @type {string} */ label) => {
    assertState(a, b, `${label}/frozen temporal`, EMBEDDED_KERNEL_BYTES);
    stateChecks++;
    assertState(js, b, `${label}/current backend temporal`, 0);
    currentStateChecks++;
    assert.deepEqual(
      b.findings,
      js.findings,
      `${label}/complete AUTO versus forced JS findings`,
    );
    spatialWitness.assertFindings(
      a.findings,
      b.findings,
      `${label}/independent spatial witness`,
    );
    assert.deepEqual(eventsB, eventsA, `${label}/frozen callbacks`);
    assert.deepEqual(eventsB, eventsJs, `${label}/current backend callbacks`);
  };
  let calls = 0,
    mixedCalls = 0;
  const dense = b.processDensePacked;
  b.processDensePacked = function (words) {
    calls++;
    if (this.representativeCount < this.width * this.height) mixedCalls++;
    return dense.call(this, words);
  };
  for (let f = 0; f < 160; f++) {
    const width = w + (mode === 'source-gap' && f >= 110 ? 1 : 0),
      height = h;
    const offset = format === 'mixed-alignment' ? (f % 3 === 0 ? 1 : 0) : 0;
    const buffer = new ArrayBuffer(width * height * 4 + offset);
    const Type =
      format === 'clamped-aligned' || (format === 'mixed-alignment' && f % 2)
        ? Uint8ClampedArray
        : Uint8Array;
    const rgba = new Type(buffer, offset, width * height * 4),
      phase = Math.floor(f / 5) % 2;
    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      let r, g, blue;
      if (mode === 'uniform' || (mode === 'alias-fork' && (f < 35 || f >= 100)))
        r = g = blue = phase ? 230 : 10;
      else if (mode === 'red') {
        r = phase ? 255 : 0;
        g = phase ? 0 : 255;
        blue = 0;
      } else {
        let n = Math.imul(p ^ 0x6d2b79f5, 0x45d9f3b);
        n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
        n = (n ^ (n >>> 16)) >>> 0;
        r = (n & 63) + (phase ? 180 : 0);
        g = ((n >>> 8) & 63) + (phase ? 180 : 0);
        blue = ((n >>> 16) & 63) + (phase ? 180 : 0);
        if (mode === 'dense-red' && p % 3 === 0) {
          r = phase ? 230 + (n & 15) : 0;
          g = phase ? 0 : 230 + ((n >>> 8) & 15);
          blue = 0;
        }
      }
      if (mode === 'mixed-shared' && width >= 32) {
        const x = p % width,
          y = Math.floor(p / width);
        // A permanent uniform strip and two exactly identical patterned
        // tiles keep aliases alive amid the independently changing image.
        // One patterned tile later forks; its old state must materialize
        // before this frame's transition, then remain independent.
        if (x < 8) r = g = blue = phase ? 230 : 10;
        else if (x < 24 && y < 8 && (x < 16 || f < 55)) {
          r = phase ? 220 + ((x + y) & 7) : 0;
          g = phase ? 0 : 220 + ((x + y) & 7);
          blue = 0;
        }
      }
      if (mode === 'alpha-black' && f >= 75 && f < 80 && p % 7 === 0)
        r = g = blue = 0;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = blue;
      rgba[i + 3] =
        mode === 'alpha-black' && f >= 50 && f < 54 && p % 11 === 0 ? 120 : 255;
    }
    const frame = {
      rgba,
      width,
      height,
      timestampMs:
        (f * 1000) / 60 + (mode === 'source-gap' && f >= 80 ? 140 : 0),
      sourceWidth: mode === 'source-gap' && f >= 90 ? width * 2 : width,
      sourceHeight: height,
    };
    a.pushFrame(frame);
    b.pushFrame(frame);
    js.pushFrame(frame);
    compare(`${key}/frame${f}`);
    if (mode === 'source-gap' && f === 130) {
      a.markInterrupted('Exact comparison interruption');
      b.markInterrupted('Exact comparison interruption');
      js.markInterrupted('Exact comparison interruption');
      compare(`${key}/explicit interruption`);
    }
  }
  const expected = a.finish(),
    actual = b.finish(),
    currentJs = js.finish();
  assert.ok(expected.quality.spatial);
  assert.ok(actual.quality.spatial);
  assert.ok(currentJs.quality.spatial);
  const expectedBudgetIncrease =
    b.wasmArena.extraAllocatedBytes + b.getBackendStats().embeddedKernelBytes;
  assert.equal(
    actual.quality.spatial.stateBytes,
    expected.quality.spatial.stateBytes + expectedBudgetIncrease,
    `${key}/memory delta`,
  );
  const expectedWithMemory = structuredClone(expected);
  assert.ok(expectedWithMemory.quality.spatial);
  expectedWithMemory.quality.spatial.stateBytes += expectedBudgetIncrease;
  expectedWithMemory.findings = spatialWitness.assertFindings(
    expected.findings,
    actual.findings,
    `${key}/finish spatial witness`,
  );
  assert.deepEqual(
    actual,
    expectedWithMemory,
    `${key}/frozen report plus justified spatial/memory deltas`,
  );
  const currentJsWithMemory = structuredClone(currentJs);
  assert.equal(
    currentJs.quality.spatial.stateBytes,
    expected.quality.spatial.stateBytes + EMBEDDED_KERNEL_BYTES,
    `${key}/forced JS explicit embedded array accounting`,
  );
  assert.ok(currentJsWithMemory.quality.spatial);
  currentJsWithMemory.quality.spatial.stateBytes +=
    b.wasmArena.extraAllocatedBytes;
  assert.deepEqual(
    actual,
    currentJsWithMemory,
    `${key}/complete AUTO versus forced JS finish`,
  );
  assert.deepEqual(eventsB, eventsA, `frozen live events ${key}`);
  assert.deepEqual(eventsB, eventsJs, `current backend live events ${key}`);
  findings += actual.findings.length;
  liveEvents += eventsB.length;
  packedFrames += calls;
  mixedSharedFrames += mixedCalls;
  const record = {
    key,
    memory: b.wasmArena.report,
    expectedBudgetIncrease,
    currentAutoVsJsBudgetIncrease: b.wasmArena.extraAllocatedBytes,
    currentJsEmbeddedBudgetIncrease: EMBEDDED_KERNEL_BYTES,
    spatialWitness: spatialWitness.evidence(),
    packedFrames: calls,
    mixedSharedFrames: mixedCalls,
    findings: actual.findings.length,
    liveEvents: eventsB.length,
    frozenResultSha256: hash(JSON.stringify(expected)),
    currentForcedJsResultSha256: hash(JSON.stringify(currentJs)),
    currentAutoResultSha256: hash(JSON.stringify(actual)),
    eventsSha256: hash(JSON.stringify(eventsB)),
  };
  return {
    record,
    findings,
    liveEvents,
    packedFrames,
    stateChecks,
    currentStateChecks,
    mixedSharedFrames,
  };
}
