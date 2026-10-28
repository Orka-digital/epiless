import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { tsImport } from 'tsx/esm/api';
import { proofIdentity } from './proof-identity.mjs';
import { runDenseCase } from './wasm-dense-case.mjs';

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
        const result = runDenseCase(
          { w, h, mode, format, diagnostics },
          { Baseline, Packed, frozenCheckerboard, EMBEDDED_KERNEL_BYTES },
        );
        records.push(result.record);
        findings += result.findings;
        liveEvents += result.liveEvents;
        packedFrames += result.packedFrames;
        stateChecks += result.stateChecks;
        currentStateChecks += result.currentStateChecks;
        mixedSharedFrames += result.mixedSharedFrames;
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
