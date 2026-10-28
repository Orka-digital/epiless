import { proofIdentity } from './proof-identity.mjs';
import { assertState } from './state-comparison.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { tsImport } from 'tsx/esm/api';
import { observeFrozenSpatial } from './spatial-witness.mjs';

// Never renders media. The oracle is frozen pre-WASM 342 source, reconstructed
// from retained exact bytes, not a second import of current production code.
const outputAt = process.argv.indexOf('--output');
const output = resolve(
  outputAt >= 0
    ? process.argv[outputAt + 1]
    : 'artifacts/wasm-dense-proof.json',
);
const candidate = new URL('../src/', import.meta.url);
const archiveBytes = await readFile(
  new URL(
    '../validation/wasm-dense-0.4.0-prototype-reconstruction.json.gz',
    import.meta.url,
  ),
);
const archive = JSON.parse(gunzipSync(archiveBytes).toString());
const temporary = await mkdtemp(join(tmpdir(), 'epiless-wasm-proof-'));
const oracle = join(temporary, 'baseline');
await mkdir(oracle);
for (const [name, text] of Object.entries(archive.files)) {
  if (name.startsWith('baseline/src/') && name.endsWith('.ts'))
    await writeFile(join(oracle, name.slice('baseline/src/'.length)), text);
}
const hash = (/** @type {import("node:crypto").BinaryLike} */ v) =>
  createHash('sha256').update(v).digest('hex');
/**
 * @param {URL} source
 */
async function sourceHash(source) {
  const tree = createHash('sha256');
  for (const name of (await readdir(source))
    .filter((x) => x.endsWith('.ts'))
    .sort())
    tree.update(name).update(await readFile(new URL(name, source)));
  return tree.digest('hex');
}
const baselineUrl = pathToFileURL(oracle + '/');
async function identity() {
  return {
    baseline: await sourceHash(baselineUrl),
    production: await sourceHash(candidate),
    kernelSourceSha256: hash(
      await readFile(new URL('wasm/dense.c', candidate)),
    ),
    kernelManifestSha256: hash(
      await readFile(new URL('wasm/kernel-manifest.json', candidate)),
    ),
    reconstructionSha256: hash(archiveBytes),
  };
}
const before = await identity();
assert.equal(
  before.baseline,
  '342483aad05cca930f02fc4503a11f92a7cf10bb501037c29ba9eb04bee02604',
);
/** @type {import("./probe-types.js").EngineModule} */
const { FrameAnalyzer: Baseline } = await tsImport(
  new URL('index.ts', baselineUrl).href,
  import.meta.url,
);
/** @type {{balancedCheckerboard:import("./probe-types.js").Checkerboard}} */
const { balancedCheckerboard: frozenCheckerboard } = await tsImport(
  new URL('spatial.ts', baselineUrl).href,
  import.meta.url,
);
/** @type {import("./probe-types.js").EngineModule} */
const { FrameAnalyzer: Packed } = await tsImport(
  new URL('index.ts', candidate).href,
  import.meta.url,
);
const { EMBEDDED_KERNEL_BYTES } = await tsImport(
  new URL('wasm-dense.ts', candidate).href,
  import.meta.url,
);
const records = [];
let findings = 0,
  liveEvents = 0,
  packedFrames = 0,
  stateChecks = 0,
  currentStateChecks = 0,
  mixedSharedFrames = 0;

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
    'mixed-shared',
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
            /** @type {import("../../core/src/index.js").Finding[]} */ ([]),
          eventsJs =
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
          assert.deepEqual(
            eventsB,
            eventsJs,
            `${label}/current backend callbacks`,
          );
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
          const offset =
            format === 'mixed-alignment' ? (f % 3 === 0 ? 1 : 0) : 0;
          const buffer = new ArrayBuffer(width * height * 4 + offset);
          const Type =
            format === 'clamped-aligned' ||
            (format === 'mixed-alignment' && f % 2)
              ? Uint8ClampedArray
              : Uint8Array;
          const rgba = new Type(buffer, offset, width * height * 4),
            phase = Math.floor(f / 5) % 2;
          for (let p = 0; p < width * height; p++) {
            const i = p * 4;
            let r, g, blue;
            if (
              mode === 'uniform' ||
              (mode === 'alias-fork' && (f < 35 || f >= 100))
            )
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
              mode === 'alpha-black' && f >= 50 && f < 54 && p % 11 === 0
                ? 120
                : 255;
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
          b.wasmArena.extraAllocatedBytes +
          b.getBackendStats().embeddedKernelBytes;
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
        assert.deepEqual(
          eventsB,
          eventsJs,
          `current backend live events ${key}`,
        );
        findings += actual.findings.length;
        liveEvents += eventsB.length;
        packedFrames += calls;
        mixedSharedFrames += mixedCalls;
        records.push({
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
        });
      }
assert.ok(packedFrames > 0, 'The optimized route must actually execute');
assert.ok(
  mixedSharedFrames > 0,
  'Shared aliases must coexist with actual WASM execution',
);
for (const format of ['uint8-aligned', 'clamped-aligned', 'mixed-alignment'])
  assert.ok(records.some((r) => r.key.includes(format) && r.packedFrames > 0));
assert.deepEqual(await identity(), before);
const result = {
  scope:
    'Three-engine numeric differential. Frozen pre-WASM 342 remains unchanged and is the exact temporal-array and first-callback oracle. Before its cluster consumes each real active mask, a separate brute-force mask/component calculation reconstructs full single-frame spatial witnesses; only strictly stronger witnessed replacements can differ from frozen accumulated reports. Frozen pattern helpers and currentMotion tie pattern/motion to that same frame. Current AUTO and current forced JS additionally match all per-push temporal state, complete findings and complete finish reports, allowing only explicitly calculated backend memory accounting. No spatial field is blindly removed or normalised. Actual mask bytes, source-frame hashes, rank changes and full replacement witnesses are retained for each spatial update. Numeric buffers only, never rendered.',
  proofFormat: 'THREE_ENGINE_SPATIAL_WITNESS_V1',
  ...(await proofIdentity(import.meta.url)),
  cases: records.length,
  findings,
  liveEvents,
  packedFrames,
  mixedSharedFrames,
  sourceHashes: before,
  backendSelection: 'AUTO; WASM required by shared-buffer assertions',
  embeddedKernelBytes: EMBEDDED_KERNEL_BYTES,
  frozenCompleteResultsIdentical: false,
  frozenTemporalStateAndCallbacksIdentical: true,
  frozenReportsMatchExceptExplicitMemoryAndProvenSpatialWitnesses: true,
  currentAutoAndForcedJsCompleteResultsMatchExceptExplicitMemory: true,
  frozenPerFrameStateChecks: stateChecks,
  currentBackendPerFrameStateChecks: currentStateChecks,
  currentBackendCallbacksIdentical: true,
  actualMasksIndependentlyChecked: records.reduce(
    (sum, r) => sum + r.spatialWitness.capturedMasks,
    0,
  ),
  witnessedSpatialUpdates: records.reduce(
    (sum, r) =>
      sum +
      r.spatialWitness.findingsWithSpatialUpdates.reduce(
        (n, f) => n + f.updates.length,
        0,
      ),
    0,
  ),
  findingsWithSpatialUpdates: records.reduce(
    (sum, r) => sum + r.spatialWitness.findingsWithSpatialUpdates.length,
    0,
  ),
  records,
};
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
await rm(temporary, { recursive: true, force: true });
console.log(JSON.stringify({ ...result, records: undefined }));
