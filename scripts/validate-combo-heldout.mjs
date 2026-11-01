import { commit, repository } from './combo-corpus.mjs';
// Independent upstream labels; numeric analysis only, never rendered media.
import assert from 'node:assert/strict';

import { open, readFile } from 'node:fs/promises';

import { resolve } from 'node:path';

import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ENGINE_VERSION,
  FrameAnalyzer,
} from '../packages/analysis-engine/src/index.ts';

import { parseSamples, summarizeCases } from './validate-detection.mjs';

import { engineTreeHash } from './validate-expanded.mjs';

import {
  backendExecution,
  detectionKernelIdentity,
} from './detection-kernel.mjs';

import {
  corpus,
  FROZEN_MANIFEST_SHA256,
  frozenEngine,
  hash,
  types,
  verifyComboCorpus,
} from './combo-corpus.mjs';
import { requiredFile } from './reference-files.mjs';

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
export {
  expectedComboChannels,
  FROZEN_MANIFEST_SHA256,
  validateComboContract,
  verifyComboCorpus,
  verifyComboFile,
} from './combo-corpus.mjs';
