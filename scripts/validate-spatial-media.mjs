import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { commit, repository } from './spatial-corpus.mjs';
import { validateSpatialVideo } from './spatial-video.mjs';

import { resolve } from 'node:path';

import { pathToFileURL } from 'node:url';

import {
  ENGINE_VERSION,
  combinedMaskFieldAnalysis,
} from '../packages/analysis-engine/src/index.ts';

import { summarizeCases } from './validate-detection.mjs';

import { detectionKernelIdentity } from './detection-kernel.mjs';

import { requiredFile } from './reference-files.mjs';
import { compareSpatialBaseline, engineHashes } from './spatial-baseline.mjs';
import {
  defaultRoot,
  safeReferencePath,
  verifySpatialCorpus,
} from './spatial-corpus.mjs';
import { command, pngPixels } from './spatial-decoding.mjs';

export async function validateSpatialMedia({
  root = defaultRoot,
  mediaDirectory = resolve('artifacts/spatial-media'),
  masksOnly = false,
  progress = /** @type {(message: string) => void} */ (() => undefined),
} = {}) {
  const reference = await verifySpatialCorpus(root);
  const before = await engineHashes();
  const kernel = await detectionKernelIdentity();
  const ffmpegVersion = command('ffmpeg', ['-version'])
    .toString()
    .split('\n')[0];
  const maskCache = /** @type {Map<string,ReturnType<typeof pngPixels>>} */ (
      new Map()
    ),
    masks = [];
  for (const item of reference.manifest.masks) {
    const pixels = pngPixels(
      safeReferencePath(reference.upstream, item.path),
      requiredFile(reference.files, item.path),
    );
    maskCache.set(item.path, pixels);
    const area = combinedMaskFieldAnalysis(
      pixels.mask,
      pixels.width,
      pixels.height,
      341,
      256,
    );
    masks.push({
      id: item.path,
      expectedCandidate: item.expectedAboveThreshold,
      observedCandidate: area.exceedsThreshold,
      ...area,
      decodedRgbaSha256: pixels.decodedRgbaSha256,
    });
  }
  const videos = [];
  if (!masksOnly) await mkdir(mediaDirectory, { recursive: true });
  for (const [index, item] of (masksOnly
    ? []
    : reference.manifest.videos
  ).entries()) {
    progress(
      `Lossless media ${index + 1}/${reference.manifest.videos.length}: ${item.path}`,
    );
    videos.push(
      await validateSpatialVideo(reference, item, maskCache, mediaDirectory),
    );
  }
  const after = await engineHashes();
  if (
    JSON.stringify(kernel) !== JSON.stringify(await detectionKernelIdentity())
  )
    throw new Error(
      'Kernel source or packaged bytes changed during validation',
    );
  if (before.sha256 !== after.sha256)
    throw new Error(
      'Engine source changed during validation; rerun a consistent build',
    );
  return {
    schemaVersion: 1,
    kernel,
    scope: masksOnly
      ? 'ORIGINAL_SPATIAL_MASKS'
      : 'LOSSLESS_DECODED_SPATIAL_TEMPORAL_MEDIA',
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    engineSource: before,
    reference: { repository, commit, manifestSha256: reference.manifestSha256 },
    decoder: {
      ffmpegVersion,
      codec: 'FFV1 level 3',
      encodedPixelFormat: 'bgra',
      decodedPixelFormat: 'rgba',
      container: 'AVI',
    },
    sourceRendering:
      'Original single-pattern opaque sRGBA samples recolour every nontransparent mask pixel over configured opaque background, matching pinned generate_frames.py. No added delivery padding, scaling, interpolation or colour conversion.',
    scopeLimitations: [
      'No browser capture or display pipeline exercised.',
      '341x256 field is the upstream fixed test geometry, not a measured physical viewing field.',
      'JSON and CSV source labels are preserved separately, including conflicts and malformed labels.',
      'Never play these generated media as part of validation. Only decoded bytes are analyzed.',
      'After first evaluation, these cases are development regressions rather than held-out validation.',
    ],
    maskSummary: summarizeCases(masks),
    masks,
    videoJsonSummary: summarizeCases(
      videos
        .filter((v) => v.jsonExpectedCandidate !== null)
        .map((v) => ({
          expectedCandidate: v.jsonExpectedCandidate,
          observedCandidate: v.observedCandidate,
        })),
    ),
    videoCsvSummary: summarizeCases(
      videos.map((v) => ({
        expectedCandidate: v.csvExpectedCandidate,
        observedCandidate: v.observedCandidate,
      })),
    ),
    sourceLabelConflicts: videos
      .filter((v) => v.sourceLabelConflict)
      .map((v) => v.id),
    videos,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2),
      outputIndex = args.indexOf('--output');
    /** @type {Awaited<ReturnType<typeof validateSpatialMedia>> & {baseline?:ReturnType<typeof compareSpatialBaseline>}} */
    const report = await validateSpatialMedia({
      masksOnly: args.includes('--masks-only'),
      progress: (value) => process.stderr.write(`${value}\n`),
    });
    if (args.includes('--check-baseline')) {
      report.baseline = compareSpatialBaseline(
        report,
        JSON.parse(
          (
            await readFile(
              resolve(defaultRoot, 'first-encounter-0.4.0.json'),
              'utf8',
            )
          ).toString(),
        ),
      );
      if (report.baseline.status === 'REGRESSION') process.exitCode = 2;
    }
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (outputIndex >= 0) {
      const output = args[outputIndex + 1];
      if (!output) throw new Error('Missing --output path');
      await writeFile(resolve(output), json, { flag: 'wx' });
      process.stdout.write(
        `${JSON.stringify({ output, maskSummary: report.maskSummary, videoJsonSummary: report.videoJsonSummary, videoCsvSummary: report.videoCsvSummary, sourceLabelConflicts: report.sourceLabelConflicts }, null, 2)}\n`,
      );
    } else process.stdout.write(json);
    if (
      args.includes('--require-match') &&
      (report.maskSummary.mismatches ||
        report.videoJsonSummary.mismatches ||
        report.videoCsvSummary.mismatches)
    )
      process.exitCode = 2;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : error}\n`,
    );
    process.exitCode = 1;
  }
}
export { compareSpatialBaseline } from './spatial-baseline.mjs';
export { safeReferencePath, verifySpatialCorpus } from './spatial-corpus.mjs';
export {
  decodePngAlpha,
  sourceFrame,
  verifyDecodedFrames,
  verifyFrameTimes,
} from './spatial-decoding.mjs';
