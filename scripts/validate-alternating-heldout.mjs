// Frozen externally authored compositions; numeric decoding only, never playback.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, open } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { basename, dirname, relative, resolve } from 'node:path';
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
import {
  decodePngAlpha,
  safeReferencePath,
  sourceFrame,
  verifyDecodedFrames,
  verifyFrameTimes,
} from './validate-spatial-media.mjs';

const corpus = fileURLToPath(
  new URL('../tests/reference/trace-alternating-heldout/', import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const FROZEN_MANIFEST_SHA256 =
  '435e47961469043376dde6e90c52e726604a66366087a6537f351cdf64740092';
const frozenEngine =
  'c216fbe2c9de76354061c35ba4df09e7e0a25731e5be247f3a7092aca2ca687a';
const repository = 'https://github.com/traceRERC/pse-test-media';
const commit = 'ef78542aad496827f25064f57aaf13d6a741ba75';
const family = 'video_creation/30fps_alternating_01';
const ids = [
  'f001c037',
  'f001f037',
  'f002c033',
  'f002c037',
  'f003c038',
  'f003f033',
  'f004c032',
  'f004c034',
  'f005c031',
  'f005f034',
  'f006c035',
  'f006f031',
  'f007c032',
  'f007c038',
  'f008c035',
  'f008c036',
];
import { requiredFile } from './reference-files.mjs';

const hash = (
  /** @type {import("node:crypto").BinaryLike} */ bytes,
  algorithm = 'sha256',
) => createHash(algorithm).update(bytes).digest('hex');

/**
 * @param {import("./helper-types.js").SourceFile & {bytes:number}} file
 * @param {Buffer} bytes
 */
export function verifyAlternatingFile(file, bytes) {
  assert.equal(file.sourceUrl, `${repository}/blob/${commit}/${file.path}`);
  assert.equal(bytes.length, file.bytes, 'Source length mismatch');
  assert.equal(hash(bytes), file.sha256, 'Source SHA-256 mismatch');
  assert.equal(
    hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1'),
    file.gitBlobSha1,
    'Git blob mismatch',
  );
}

/** Labels and event annotations are checked against original bytes, never inferred from engine output. */
/**
 * @param {import("./helper-types.js").AlternatingManifest} manifest
 * @param {Map<string, Buffer>} files
 */
export function validateAlternatingContract(manifest, files) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.repository, repository);
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.frozenEngineTreeSha256, frozenEngine);
  assert.equal(manifest.files.length, 46);
  assert.equal(
    new Set(manifest.files.map((f) => f.path)).size,
    46,
    'Duplicate reference',
  );
  assert.deepEqual(
    manifest.videos.map((v) => v.path).sort(),
    ids.map((id) => `${family}/${id}.json`),
    'All 16 selected configurations must remain present',
  );
  const rows = requiredFile(files, `${family}/30fps_alternating_01.csv`)
    .toString()
    .trim()
    .split(/\r?\n/);
  assert.equal(rows.shift(), 'filename,pass,dimension');
  const labels = new Map(
    rows.map((row) => {
      const [id, pass, dimension] = row.split(',');
      return [id, { pass, dimension }];
    }),
  );
  assert.equal(labels.size, 16);
  assert.deepEqual([...labels.keys()].sort(), ids);
  const spatial = new Set(),
    temporal = new Set();
  for (const item of manifest.videos) {
    /** @type {import("./helper-types.js").VideoConfig} */
    const config = JSON.parse(requiredFile(files, item.path).toString());
    assert.equal(config.framerate, 30);
    assert.equal(config.colormodel, 'sRGBA');
    assert.equal(config.pattern.length, 1);
    assert.match(config.bgcolor, /^\(\d+,\d+,\d+,255\)$/);
    const label = labels.get(basename(item.path, '.json'));
    assert.ok(label, 'Missing source label');
    assert.ok(['TRUE', 'FALSE'].includes(label.pass));
    assert.ok(['count', 'FAIL'].includes(label.dimension));
    assert.equal(
      item.upstreamCsvPass,
      label.pass,
      'Original CSV label changed',
    );
    assert.equal(
      item.upstreamCsvDimension,
      label.dimension,
      'Original CSV dimension changed',
    );
    assert.equal(
      item.expectedWcagClassic,
      config.expected_result?.wcag2_2,
      'Original JSON label changed',
    );
    assert.deepEqual(
      item.eventAnnotations,
      config.events ?? null,
      'Original event annotations changed',
    );
    assert.deepEqual(
      item.failureDetails,
      config.failure_details ?? null,
      'Original failure annotations changed',
    );
    for (const key of /** @type {const} */ (['spatial', 'temporal_color'])) {
      const dep = relative(
        '/upstream',
        safeReferencePath(
          '/upstream',
          resolve('/upstream', dirname(item.path), config.pattern[0][key]),
        ),
      );
      assert.equal(item.dependencies[key], dep, 'Dependency identity changed');
      assert.ok(files.has(dep), 'Dependency missing');
    }
    spatial.add(item.dependencies.spatial);
    temporal.add(item.dependencies.temporal_color);
  }
  assert.equal(spatial.size, 8);
  assert.equal(temporal.size, 12);
  assert.deepEqual(manifest.counts, {
    configurations: 16,
    spatialSources: 8,
    temporalSources: 12,
    files: 46,
    csvExpectedPositives: 4,
    csvExpectedNegatives: 12,
    spatialSourcesWithPreviousBytes: 0,
    temporalSourcesWithPreviousBytes: 12,
  });
  return { spatial, temporal };
}

export async function verifyAlternatingCorpus(root = corpus) {
  const bytes = await readFile(resolve(root, 'manifest.json'));
  assert.equal(
    hash(bytes),
    FROZEN_MANIFEST_SHA256,
    'Pre-scoring manifest changed',
  );
  /** @type {import("./helper-types.js").AlternatingManifest} */
  const manifest = JSON.parse(bytes.toString()),
    files = /** @type {Map<string,Buffer>} */ (new Map());
  for (const file of manifest.files) {
    const bytes = await readFile(
      safeReferencePath(resolve(root, 'upstream'), file.path),
    );
    verifyAlternatingFile(file, bytes);
    files.set(file.path, bytes);
  }
  const sets = validateAlternatingContract(manifest, files);
  /** @type {(import("./helper-types.js").SourceFile & {manifest:string})[]} */
  const prior = [];
  for (const file of manifest.priorManifests) {
    const bytes = await readFile(safeReferencePath(repositoryRoot, file.path));
    assert.equal(hash(bytes), file.sha256, 'Prior overlap inventory changed');
    for (const item of JSON.parse(bytes.toString()).files)
      prior.push({ manifest: file.path, ...item });
  }
  for (const file of manifest.files) {
    const overlap = prior
      .filter((old) => old.sha256 === file.sha256)
      .map((old) => ({
        manifest: old.manifest,
        path: old.path,
        match:
          old.path === file.path
            ? 'SAME_PATH_AND_BYTES'
            : 'SAME_BYTES_DIFFERENT_PATH',
      }));
    assert.deepEqual(
      file.overlapWithPriorCorpora,
      overlap,
      'Overlap inventory changed',
    );
    if (
      (file.path.endsWith('.json') && file.path.startsWith(family + '/')) ||
      sets.spatial.has(file.path)
    )
      assert.equal(
        overlap.length,
        0,
        'New composition/mask was already evaluated',
      );
    if (sets.temporal.has(file.path))
      assert.ok(
        overlap.length,
        'Known temporal source incorrectly described as unseen',
      );
  }
  return { manifest, files, upstream: resolve(root, 'upstream') };
}

/**
 * @param {string} executable
 * @param {string[]} args
 */
function command(executable, args) {
  const result = spawnSync(executable, args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${executable}: ${result.error?.message ?? result.stderr.toString().slice(-2000)}`,
    );
  return result.stdout;
}
/**
 * @param {string[]} args
 * @param {string} executable
 */
function child(executable, args) {
  const process = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let error = '';
  process.stderr.on('data', (chunk) => {
    error = (error + chunk.toString()).slice(-4000);
  });
  const done = new Promise(
    /** @param {(value?: unknown) => void} resolve */ (resolve, reject) => {
      process.once('error', reject);
      process.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`${executable} failed (${code}): ${error}`)),
      );
    },
  );
  done.catch(() => undefined);
  return { process, done };
}
/**
 * @param {Awaited<ReturnType<typeof verifyAlternatingCorpus>>} reference
 * @param {string} path
 */
async function verifyMask(reference, path) {
  const independent = decodePngAlpha(requiredFile(reference.files, path));
  assert.equal(independent.width, 1920);
  assert.equal(independent.height, 1080);
  const rgba = command('ffmpeg', [
    '-v',
    'error',
    '-threads',
    '1',
    '-i',
    safeReferencePath(reference.upstream, path),
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ]);
  assert.equal(rgba.length, 1920 * 1080 * 4);
  for (let i = 0; i < independent.mask.length; i++) {
    assert.ok(
      rgba[i * 4 + 3] === 0 || rgba[i * 4 + 3] === 255,
      'Nonbinary alpha requires separate source contract',
    );
    assert.equal(
      independent.mask[i],
      Number(rgba[i * 4 + 3] !== 0),
      'Independent PNG decoder mismatch',
    );
  }
  return { ...independent, decodedRgbaSha256: hash(rgba) };
}

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
      /** @type {Map<string,Awaited<ReturnType<typeof verifyMask>>>} */ (
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
    if (!masks.has(item.dependencies.spatial))
      masks.set(
        item.dependencies.spatial,
        await verifyMask(reference, item.dependencies.spatial),
      );
    const pixels = masks.get(item.dependencies.spatial),
      background = config.bgcolor.slice(1, -1).split(',').map(Number);
    assert.ok(pixels, 'Missing verified mask');
    const mediaName = basename(item.path, '.json') + '.avi',
      mediaPath = resolve(mediaDirectory, mediaName);
    const encoder = child('ffmpeg', [
      '-v',
      'error',
      '-n',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s:v',
      '1920x1080',
      '-r',
      '30',
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'ffv1',
      '-level',
      '3',
      '-pix_fmt',
      'bgra',
      '-threads',
      '1',
      mediaPath,
    ]);
    encoder.process.stdout.resume();
    const generatedHashes = [];
    try {
      for (const sample of samples) {
        const frame = sourceFrame(pixels.mask, background, sample);
        generatedHashes.push(hash(frame));
        if (!encoder.process.stdin.write(frame))
          await once(encoder.process.stdin, 'drain');
      }
      encoder.process.stdin.end();
      await encoder.done;
    } catch (error) {
      encoder.process.kill();
      await encoder.done.catch(() => undefined);
      throw error;
    }
    const probe = JSON.parse(
      command('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height,r_frame_rate:frame=best_effort_timestamp_time',
        '-of',
        'json',
        mediaPath,
      ]).toString(),
    );
    const times = verifyFrameTimes(probe, samples.length, 30);
    const analyzer = new FrameAnalyzer({
      maxPixels: 1920 * 1080,
      minEffectiveFps: 29,
      diagnostics: false,
      visualField: {
        widthPx: 341,
        heightPx: 256,
        basis: 'W3C_1024_768_REFERENCE',
        reference:
          'Upstream fixed 341x256 source-pixel field; not viewer calibration or CSS/display inference.',
      },
    });
    const decoder = child('ffmpeg', [
      '-v',
      'error',
      '-threads',
      '1',
      '-i',
      mediaPath,
      '-an',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-fps_mode',
      'passthrough',
      'pipe:1',
    ]);
    decoder.process.stdin.end();
    let decodedHashes;
    try {
      decodedHashes = await verifyDecodedFrames(
        decoder.process.stdout,
        1920 * 1080 * 4,
        generatedHashes,
        (rgba, i) =>
          analyzer.pushFrame({
            rgba: new Uint8Array(rgba),
            width: 1920,
            height: 1080,
            sourceWidth: 1920,
            sourceHeight: 1080,
            timestampMs: times[i],
          }),
      );
      await decoder.done;
    } catch (error) {
      decoder.process.kill();
      await decoder.done.catch(() => undefined);
      throw error;
    }
    const result = analyzer.finish(),
      general = result.findings.filter((f) => f.type === 'GENERAL_FLASH');
    const observedCandidate = general.some(
      (f) => f.spatial?.visualField?.exceedsThreshold === true,
    );
    const jsonExpected = ['pass', 'fail'].includes(item.expectedWcagClassic)
      ? item.expectedWcagClassic === 'fail'
      : null;
    const csvExpected = item.upstreamCsvPass === 'FALSE';
    cases.push({
      id: item.path,
      dependencies: item.dependencies,
      upstreamJsonLabel: item.expectedWcagClassic,
      jsonExpectedCandidate: jsonExpected,
      upstreamCsvPass: item.upstreamCsvPass,
      upstreamCsvDimension: item.upstreamCsvDimension,
      csvExpectedCandidate: csvExpected,
      sourceLabelConflict:
        jsonExpected === null || jsonExpected !== csvExpected,
      observedCandidate,
      jsonAgreement:
        jsonExpected === null ? null : jsonExpected === observedCandidate,
      csvAgreement: csvExpected === observedCandidate,
      eventAnnotationsUnscored: item.eventAnnotations,
      failureDetailsUnscored: item.failureDetails,
      frameCount: samples.length,
      frameRate: 30,
      width: 1920,
      height: 1080,
      mediaFile: mediaName,
      mediaSha256: hash(await readFile(mediaPath)),
      maskDecodedRgbaSha256: pixels.decodedRgbaSha256,
      generatedFrameSha256: generatedHashes,
      decodedFrameSha256: decodedHashes,
      decodedFrameTimestampMs: times,
      engineStatus: result.status,
      findings: result.findings,
      quality: result.quality,
      analysisBackend: backendExecution(analyzer),
    });
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
  const harnessFiles = await Promise.all(
    [
      'validate-alternating-heldout.mjs',
      'validate-spatial-media.mjs',
      'validate-detection.mjs',
      'validate-expanded.mjs',
      'detection-kernel.mjs',
    ].map(async (path) => ({
      path,
      sha256: hash(await readFile(new URL(path, import.meta.url))),
    })),
  );
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
