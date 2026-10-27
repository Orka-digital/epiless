// Independent upstream labels; numeric analysis only, never rendered media.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  FrameAnalyzer,
  ENGINE_VERSION,
} from '../packages/analysis-engine/src/index.ts';
import { parseSamples, summarizeCases } from './validate-detection.mjs';
import { engineTreeHash } from './validate-expanded.mjs';
import {
  backendExecution,
  detectionKernelIdentity,
} from './detection-kernel.mjs';

const corpus = fileURLToPath(
  new URL('../tests/reference/trace-combo-heldout/', import.meta.url),
);
export const FROZEN_MANIFEST_SHA256 =
  'abaca272c1b8b0f0d58867bc14c077f7665d21cc67f72da82514370dee39cc36';
const frozenEngine =
  'c216fbe2c9de76354061c35ba4df09e7e0a25731e5be247f3a7092aca2ca687a';
const commit = 'ef78542aad496827f25064f57aaf13d6a741ba75';
const repository = 'https://github.com/traceRERC/pse-test-media';
const hash = (
  /** @type {import("node:crypto").BinaryLike} */ bytes,
  algorithm = 'sha256',
) => createHash(algorithm).update(bytes).digest('hex');
import { requiredFile } from './reference-files.mjs';
const types = ['GENERAL_FLASH', 'RED_FLASH'];

/** This oracle comes solely from the pinned upstream README suffix convention. */
/**
 * @param {string} path
 */
export function expectedComboChannels(path) {
  const match = /^combo_flash_patterns\/30fps\/00[12](fb|fl|fr|p)\.csv$/.exec(
    path,
  );
  assert.ok(match, 'Unknown combo source: its label must remain unscored.');
  /** @type {Record<string, boolean[]>} */
  const labels = {
    fb: [true, true],
    fl: [true, false],
    fr: [false, true],
    p: [false, false],
  };
  return Object.fromEntries(
    types.map((type, index) => [type, labels[match[1]][index]]),
  );
}

/**
 * @param {import("./helper-types.js").ComboManifest} manifest
 */
export function validateComboContract(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.upstreamRepository, repository);
  assert.equal(manifest.upstreamCommit, commit);
  assert.equal(manifest.license, 'BSD-3-Clause');
  assert.equal(manifest.independentInputs, 8);
  assert.equal(manifest.channelChecks, 16);
  assert.equal(manifest.frozenEngine.typescriptTreeSha256, frozenEngine);
  assert.equal(manifest.files.length, 10);
  const paths = manifest.files.map((file) => file.path);
  assert.equal(new Set(paths).size, paths.length, 'Duplicate reference file');
  const required = ['LICENSE', 'combo_flash_patterns/30fps/README.md'];
  for (const series of ['001', '002'])
    for (const suffix of ['fb', 'fl', 'fr', 'p'])
      required.push(`combo_flash_patterns/30fps/${series}${suffix}.csv`);
  assert.deepEqual(
    [...paths].sort(),
    required.sort(),
    'All original inputs must remain selected.',
  );
  for (const file of manifest.files) {
    assert.equal(file.sourceUrl, `${repository}/blob/${commit}/${file.path}`);
    if (file.kind !== 'PROVENANCE') {
      assert.equal(file.kind, 'COMBINED_GENERAL_RED');
      assert.equal(file.framesPerSecond, 30);
      assert.deepEqual(
        file.expectedChannels,
        expectedComboChannels(file.path),
        'Upstream suffix labels must not be changed.',
      );
    } else assert.equal(file.kind, 'PROVENANCE');
  }
}

/**
 * @param {import("./helper-types.js").SourceFile & {size:number}} file
 * @param {Buffer} bytes
 */
export function verifyComboFile(file, bytes) {
  assert.equal(bytes.length, file.size, `Source length mismatch: ${file.path}`);
  assert.equal(
    hash(bytes),
    file.sha256,
    `Source SHA-256 mismatch: ${file.path}`,
  );
  assert.equal(
    hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1'),
    file.gitBlobSha1,
    `Git blob mismatch: ${file.path}`,
  );
}

export async function verifyComboCorpus(root = corpus) {
  const bytes = await readFile(resolve(root, 'manifest.json'));
  assert.equal(
    hash(bytes),
    FROZEN_MANIFEST_SHA256,
    'The pre-scoring manifest changed.',
  );
  /** @type {import("./helper-types.js").ComboManifest} */
  const manifest = JSON.parse(bytes.toString());
  validateComboContract(manifest);
  /** @type {Map<string, Buffer>} */
  const contents = new Map();
  for (const file of manifest.files) {
    const data = await readFile(resolve(root, 'upstream', file.path));
    verifyComboFile(file, data);
    contents.set(file.path, data);
  }
  /** @type {{files: import("./helper-types.js").SourceFile[]}[]} */
  const previous = await Promise.all(
    ['trace-pse', 'trace-pse-expanded', 'trace-spatial'].map(async (name) =>
      JSON.parse(
        (
          await readFile(
            new URL(
              `../tests/reference/${name}/manifest.json`,
              import.meta.url,
            ),
          )
        ).toString(),
      ),
    ),
  );
  for (const file of manifest.files.filter((file) =>
    file.path.endsWith('.csv'),
  )) {
    assert.ok(
      !previous.some((source) =>
        source.files.some(
          (prior) =>
            prior.path === file.path || prior.gitBlobSha1 === file.gitBlobSha1,
        ),
      ),
      'An already evaluated input must not be called held out.',
    );
  }
  return { manifest, contents };
}

export async function validateComboHeldout(root = corpus) {
  const { manifest, contents } = await verifyComboCorpus(root);
  assert.equal(
    await engineTreeHash(),
    frozenEngine,
    'Only the selected frozen engine may be scored.',
  );
  const kernel = await detectionKernelIdentity();
  assert.equal(kernel.sourceSha256, manifest.frozenEngine.kernelSourceSha256);
  assert.equal(
    kernel.manifestSha256,
    manifest.frozenEngine.kernelManifestSha256,
  );
  const cases = [],
    unscored = [];
  for (const file of manifest.files.filter(
    (file) => file.kind === 'COMBINED_GENERAL_RED',
  )) {
    let samples;
    try {
      samples = parseSamples(
        requiredFile(contents, file.path).toString('utf8'),
      );
      assert.ok(
        samples.every((rgba) => rgba[3] === 255),
        'Transparent samples require a separately defined compositing oracle.',
      );
    } catch (error) {
      unscored.push({
        id: file.path,
        expectedChannels: file.expectedChannels,
        reason: String(
          (error instanceof Error ? error.message : String(error)) ?? error,
        ),
      });
      continue;
    }
    const analyzer = new FrameAnalyzer();
    samples.forEach((rgba, index) =>
      analyzer.pushFrame({
        rgba,
        width: 1,
        height: 1,
        timestampMs: (index * 1000) / 30,
      }),
    );
    const result = analyzer.finish();
    cases.push({
      id: file.path,
      sourceSha256: file.sha256,
      frames: samples.length,
      engineStatus: result.status,
      analysisBackend: backendExecution(analyzer),
      channels: types.map((kind) => {
        const candidates = result.findings
          .filter((finding) => finding.type === kind)
          .map(({ startMs, endMs }) => ({ startMs, endMs }));
        return {
          kind,
          expectedCandidate: file.expectedChannels[kind],
          observedCandidate: candidates.length > 0,
          agreement: file.expectedChannels[kind] === candidates.length > 0,
          candidates,
        };
      }),
    });
  }
  assert.equal(
    await engineTreeHash(),
    frozenEngine,
    'Engine changed during evaluation.',
  );
  assert.deepEqual(
    await detectionKernelIdentity(),
    kernel,
    'Kernel changed during evaluation.',
  );
  assert.equal(
    hash(await readFile(resolve(root, 'manifest.json'))),
    FROZEN_MANIFEST_SHA256,
    'Manifest changed during evaluation.',
  );
  const channelChecks = cases.flatMap((item) => item.channels);
  return {
    schemaVersion: 1,
    evaluatedAt: new Date().toISOString(),
    scope: 'FIRST_ENCOUNTER_COMBINED_TEMPORAL_INTENSITY_CHANNELS',
    selectionFrozenAt: manifest.selectedBeforeEvaluationAt,
    engineVersion: ENGINE_VERSION,
    engineTreeSha256: frozenEngine,
    kernel,
    harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    reference: {
      repository,
      commit,
      manifestSha256: FROZEN_MANIFEST_SHA256,
      filesVerified: manifest.files.length,
    },
    independentInputs: 8,
    scoredInputs: cases.length,
    channelChecks: channelChecks.length,
    inputsWithAnyMismatch: cases.filter((item) =>
      item.channels.some((channel) => !channel.agreement),
    ).length,
    channelSummary: summarizeCases(channelChecks),
    byType: Object.fromEntries(
      types.map((kind) => [
        kind,
        summarizeCases(channelChecks.filter((item) => item.kind === kind)),
      ]),
    ),
    verdict: unscored.length
      ? 'SOURCE_CASES_UNSCORED'
      : channelChecks.some((item) => !item.agreement)
        ? 'MISMATCHES'
        : 'ALL_SELECTED_CHANNELS_AGREE',
    conformanceEstablished: false,
    passed: null,
    methodology:
      'Eight previously unselected upstream inputs, pinned before evaluation, each projected verbatim onto one pixel at 30 fps. Two channel checks per input are correlated, not sixteen independent inputs. Upstream fb/fl/fr/p suffixes supply the external general/red oracle. No engine changes, padding, rendered media or outcome-based exclusions. After first encounter this set is regression data.',
    unsupported: [
      'Combined visual-field area and physical display calibration',
      'Capture, decoding, motion and fine-pattern exceptions',
      'Real-world sensitivity, WCAG conformance, clinical safety and state-of-the-art claims',
    ],
    cases,
    unscored,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    assert.equal(
      args.length,
      2,
      'Usage: node --import tsx scripts/validate-combo-heldout.mjs --output NEW.json',
    );
    assert.equal(args[0], '--output');
    // Reserve a new result before scoring; never rerun merely to overwrite evidence.
    const output = await open(args[1], 'wx');
    let report;
    try {
      report = await validateComboHeldout();
      await output.writeFile(JSON.stringify(report, null, 2) + '\n');
    } finally {
      await output.close();
    }
    console.log(
      JSON.stringify(
        {
          output: args[1],
          independentInputs: report.independentInputs,
          scoredInputs: report.scoredInputs,
          channelChecks: report.channelChecks,
          verdict: report.verdict,
          channelSummary: report.channelSummary,
          unscored: report.unscored,
        },
        null,
        2,
      ),
    );
    if (report.verdict !== 'ALL_SELECTED_CHANNELS_AGREE') process.exitCode = 2;
  } catch (error) {
    console.error(
      String((error instanceof Error ? error.message : String(error)) ?? error),
    );
    process.exitCode = 1;
  }
}
