import { commit, repository } from './alternating-corpus.mjs';
import { alternatingHarnessIdentity } from './alternating-harness-identity.mjs';
import { validateAlternatingVideo } from './alternating-video.mjs';
// Frozen externally authored compositions; numeric decoding only, never playback.
import assert from 'node:assert/strict';

import { mkdir, open } from 'node:fs/promises';

import { resolve } from 'node:path';

import { fileURLToPath, pathToFileURL } from 'node:url';

import { ENGINE_VERSION } from '../packages/analysis-engine/src/index.ts';

import { parseSamples, summarizeCases } from './validate-detection.mjs';

import { engineTreeHash } from './validate-expanded.mjs';

import { detectionKernelIdentity } from './detection-kernel.mjs';

import {
  corpus,
  FROZEN_MANIFEST_SHA256,
  frozenEngine,
  verifyAlternatingCorpus,
} from './alternating-corpus.mjs';
import { command } from './alternating-media.mjs';
import { requiredFile } from './reference-files.mjs';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

async function validateAlternatingHeldout({
  root = corpus,
  mediaDirectory = resolve('artifacts/alternating-heldout'),
  progress = /** @type {(message: string) => void} */ (() => undefined),
} = {}) {
  const reference = await verifyAlternatingCorpus(root);
  assert.equal(
    await engineTreeHash(),
    frozenEngine,
    'Only unchanged c216 may provide this first encounter',
  );
  const kernel = await detectionKernelIdentity();
  const ffmpegVersion = command('ffmpeg', ['-version'])
    .toString()
    .split('\n')[0];
  const ffprobeVersion = command('ffprobe', ['-version'])
    .toString()
    .split('\n')[0];
  const masks =
      /** @type {Map<string,Awaited<ReturnType<typeof import('./alternating-media.mjs').verifyMask>>>} */ (
        new Map()
      ),
    cases = /** @type {import("./helper-types.js").AlternatingCase[]} */ ([]),
    unscored = [];
  await mkdir(mediaDirectory, { recursive: true });
  for (const [index, item] of reference.manifest.videos.entries()) {
    progress(`Lossless first encounter ${index + 1}/16: ${item.path}`);
    /** @type {import("./helper-types.js").VideoConfig} */
    const config = JSON.parse(
      requiredFile(reference.files, item.path).toString(),
    );
    let samples;
    try {
      samples = parseSamples(
        requiredFile(
          reference.files,
          item.dependencies.temporal_color,
        ).toString(),
        { allowZeroBased: true },
      );
      assert.ok(
        samples.every((rgba) => rgba[3] === 255),
        'Transparent samples require a separate oracle',
      );
    } catch (error) {
      unscored.push({
        id: item.path,
        reason: String(
          (error instanceof Error ? error.message : String(error)) ?? error,
        ),
      });
      continue;
    }
    cases.push(
      await validateAlternatingVideo(
        reference,
        item,
        masks,
        config,
        samples,
        mediaDirectory,
      ),
    );
  }
  assert.equal(
    await engineTreeHash(),
    frozenEngine,
    'Engine changed during first encounter',
  );
  assert.deepEqual(
    await detectionKernelIdentity(),
    kernel,
    'Kernel changed during first encounter',
  );
  await verifyAlternatingCorpus(root);
  const summary = (
    /** @type {'jsonExpectedCandidate' | 'csvExpectedCandidate'} */ key,
  ) =>
    summarizeCases(
      cases
        .filter((c) => c[key] !== null)
        .map((c) => ({
          expectedCandidate: c[key],
          observedCandidate: c.observedCandidate,
        })),
    );
  const harnessFiles = await alternatingHarnessIdentity();
  return {
    schemaVersion: 1,
    scope:
      'FIRST_ENCOUNTER_UNSEEN_COMPOSITIONS_WITH_KNOWN_TEMPORAL_DEPENDENCIES',
    evaluatedAt: new Date().toISOString(),
    selectionFrozenAt: reference.manifest.frozenBeforeScoringAt,
    engineVersion: ENGINE_VERSION,
    engineTreeSha256: frozenEngine,
    kernel,
    harnessFiles,
    reference: {
      repository,
      commit,
      manifestSha256: FROZEN_MANIFEST_SHA256,
      filesVerified: 46,
      overlap: reference.manifest.counts,
    },
    decoder: {
      ffmpegVersion,
      ffprobeVersion,
      codec: 'FFV1 level 3',
      encodedPixelFormat: 'bgra',
      decodedPixelFormat: 'rgba',
      container: 'AVI',
      encoderThreads: 1,
    },
    selectedInputs: 16,
    scoredInputs: cases.length,
    totalDecodedFrames: cases.reduce((n, c) => n + c.frameCount, 0),
    jsonSummary: summary('jsonExpectedCandidate'),
    csvSummary: summary('csvExpectedCandidate'),
    sourceLabelConflicts: cases
      .filter((c) => c.sourceLabelConflict)
      .map((c) => c.id),
    verdict: unscored.length
      ? 'SOURCE_CASES_UNSCORED'
      : cases.some((c) => !c.csvAgreement || c.jsonAgreement === false)
        ? 'MISMATCHES'
        : 'ALL_SELECTED_CONFIGURATIONS_AGREE',
    passed: null,
    conformanceEstablished: false,
    scopeLimitations: [
      'All 16 configurations and 8 masks were unselected before this evaluation; all 12 temporal CSV dependencies already occurred in prior corpora. These are not 16 independent unseen temporal oracles.',
      'Original opaque source pixels are losslessly encoded and decoded without padding, interpolation or rescaling. Every decoded frame hash and PTS is checked. No media playback or browser/display pipeline is exercised.',
      'The explicit 341x256 source-pixel field is an upstream reference geometry, not measured physical calibration or a CSS mapping.',
      'Original JSON and CSV labels remain separate; event annotations are retained but unscored until their frame-index/endpoint convention is independently established.',
      'After this first encounter the selected corpus is development regression data. No real-world accuracy, clinical safety, WCAG conformance or state-of-the-art claim follows.',
    ],
    cases,
    unscored,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const outputArg = process.argv.indexOf('--output');
  const output =
    outputArg >= 0
      ? process.argv[outputArg + 1]
      : resolve(corpus, 'first-encounter-0.4.0.json');
  const mediaArg = process.argv.indexOf('--media-directory');
  const destination = await open(output, 'wx');
  try {
    const report = await validateAlternatingHeldout({
      mediaDirectory: mediaArg >= 0 ? process.argv[mediaArg + 1] : undefined,
      progress: (message) => process.stderr.write(message + '\n'),
    });
    await destination.writeFile(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(
      JSON.stringify({
        output,
        verdict: report.verdict,
        jsonSummary: report.jsonSummary,
        csvSummary: report.csvSummary,
        frames: report.totalDecodedFrames,
      }) + '\n',
    );
  } catch (error) {
    await destination.writeFile(
      JSON.stringify(
        {
          status: 'FAILED_INTEGRITY_OR_HARNESS',
          failedAt: new Date().toISOString(),
          error: String(
            error instanceof Error ? (error.stack ?? error.message) : error,
          ),
        },
        null,
        2,
      ) + '\n',
    );
    process.exitCode = 1;
    process.stderr.write(
      String(error instanceof Error ? (error.stack ?? error.message) : error) +
        '\n',
    );
  } finally {
    await destination.close();
  }
}
export {
  FROZEN_MANIFEST_SHA256,
  validateAlternatingContract,
  verifyAlternatingCorpus,
  verifyAlternatingFile,
} from './alternating-corpus.mjs';
