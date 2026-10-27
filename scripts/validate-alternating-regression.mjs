import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, open } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  FrameAnalyzer,
  ENGINE_VERSION,
} from '../packages/analysis-engine/src/index.ts';
import {
  verifyAlternatingCorpus,
  FROZEN_MANIFEST_SHA256,
} from './validate-alternating-heldout.mjs';
import { decodePngAlpha } from './validate-spatial-media.mjs';
import { parseSamples, summarizeCases } from './validate-detection.mjs';
import { engineTreeHash } from './validate-expanded.mjs';
import {
  detectionKernelIdentity,
  backendExecution,
} from './detection-kernel.mjs';
import {
  encodeDecodeReference,
  losslessCodecVersions,
} from './reference-ffv1.mjs';
const root = fileURLToPath(
  new URL('../tests/reference/trace-alternating-heldout/', import.meta.url),
);
import { requiredFile } from './reference-files.mjs';
const hash = (/** @type {import("node:crypto").BinaryLike} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export const FIRST_ENCOUNTER_SHA256 =
  'd7e80663cd062b14edb1ec5d72de9f0e249f9ab904979e9715ffc976250e9b74';

export async function verifyAlternatingFirstEncounter() {
  const bytes = await readFile(resolve(root, 'first-encounter-0.4.0.json'));
  assert.equal(
    hash(bytes),
    FIRST_ENCOUNTER_SHA256,
    'Original first encounter must remain unchanged',
  );
  /** @type {{cases:import("./helper-types.js").VideoCase[], scope:string, engineTreeSha256:string, reference:{manifestSha256:string}, scoredInputs:number, scopeLimitations:string[], unscored:unknown[], totalDecodedFrames:number}} */
  const baseline = JSON.parse(bytes.toString());
  assert.equal(baseline.reference.manifestSha256, FROZEN_MANIFEST_SHA256);
  assert.equal(baseline.scoredInputs, 16);
  assert.deepEqual(baseline.unscored, []);
  assert.equal(baseline.totalDecodedFrames, 544);
  return baseline;
}

/** Case identity, source frames, PTS and both independent labels remain fixed. */
/**
 * @param {import("./helper-types.js").VideoCase[]} current
 * @param {{cases: import("./helper-types.js").VideoCase[]}} baseline
 */
export function compareAlternatingBaseline(current, baseline) {
  assert.equal(current.length, baseline.cases.length, 'Case selection changed');
  assert.equal(
    new Set(current.map((c) => c.id)).size,
    current.length,
    'Duplicate case',
  );
  const prior = new Map(baseline.cases.map((c) => [c.id, c]));
  const knownMismatches = [],
    newMismatches = [],
    improvements = [];
  for (const item of current) {
    const old = prior.get(item.id);
    assert.ok(old, 'Unknown case identity');
    for (const key of /** @type {const} */ ([
      'jsonExpectedCandidate',
      'csvExpectedCandidate',
      'frameCount',
      'frameRate',
      'width',
      'height',
    ]))
      assert.equal(
        item[key],
        old[key],
        `Frozen label or geometry changed: ${key}`,
      );
    for (const key of /** @type {const} */ ([
      'generatedFrameSha256',
      'decodedFrameSha256',
      'decodedFrameTimestampMs',
    ]))
      assert.deepEqual(
        item[key],
        old[key],
        `Frozen decoded evidence changed: ${key}`,
      );
    assert.equal(typeof item.observedCandidate, 'boolean');
    for (const label of /** @type {const} */ ([
      'jsonExpectedCandidate',
      'csvExpectedCandidate',
    ])) {
      if (item[label] === null) continue;
      const wasMismatch = old[label] !== old.observedCandidate,
        isMismatch = item[label] !== item.observedCandidate;
      const id = `${label}:${item.id}`;
      if (wasMismatch && isMismatch) knownMismatches.push(id);
      else if (isMismatch) newMismatches.push(id);
      else if (wasMismatch) improvements.push(id);
    }
  }
  return {
    status: newMismatches.length ? 'REGRESSION' : 'NO_NEW_MISMATCHES',
    knownMismatches,
    newMismatches,
    improvements,
  };
}

export async function validateAlternatingRegression({
  mediaDirectory = resolve('artifacts/alternating-regression-media'),
  progress = /** @type {(message: string) => void} */ (() => undefined),
} = {}) {
  const reference = await verifyAlternatingCorpus(),
    baseline = await verifyAlternatingFirstEncounter();
  const engine = await engineTreeHash(),
    kernel = await detectionKernelIdentity(),
    codec = losslessCodecVersions();
  const cases = [],
    masks = /** @type {Map<string,ReturnType<typeof decodePngAlpha>>} */ (
      new Map()
    );
  await mkdir(mediaDirectory, { recursive: true });
  for (const [index, item] of reference.manifest.videos.entries()) {
    progress(`Alternating regression ${index + 1}/16: ${item.path}`);
    const old = baseline.cases.find((c) => c.id === item.path);
    assert.ok(old);
    /** @type {import("./helper-types.js").VideoConfig} */
    const config = JSON.parse(
      requiredFile(reference.files, item.path).toString(),
    );
    assert.equal(
      old.jsonExpectedCandidate,
      config.expected_result.wcag2_2 === 'fail',
    );
    assert.equal(old.csvExpectedCandidate, item.upstreamCsvPass === 'FALSE');
    if (!masks.has(item.dependencies.spatial))
      masks.set(
        item.dependencies.spatial,
        decodePngAlpha(
          requiredFile(reference.files, item.dependencies.spatial),
        ),
      );
    const pixels = masks.get(item.dependencies.spatial);
    assert.ok(pixels, 'Missing decoded mask');
    assert.equal(pixels.width, 1920);
    assert.equal(pixels.height, 1080);
    const samples = parseSamples(
      requiredFile(
        reference.files,
        item.dependencies.temporal_color,
      ).toString(),
      { allowZeroBased: true },
    );
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
    const mediaFile = basename(item.path, '.json') + '.avi';
    const decoded = await encodeDecodeReference({
      mask: pixels.mask,
      background: config.bgcolor.slice(1, -1).split(',').map(Number),
      samples,
      frameRate: 30,
      mediaPath: resolve(mediaDirectory, mediaFile),
      expectedHashes: old.generatedFrameSha256,
      expectedTimes: old.decodedFrameTimestampMs,
      onFrame: (rgba, timestampMs) =>
        analyzer.pushFrame({
          rgba: new Uint8Array(rgba),
          width: 1920,
          height: 1080,
          sourceWidth: 1920,
          sourceHeight: 1080,
          timestampMs,
        }),
    });
    const result = analyzer.finish();
    cases.push({
      id: item.path,
      jsonExpectedCandidate: old.jsonExpectedCandidate,
      csvExpectedCandidate: old.csvExpectedCandidate,
      observedCandidate: result.findings.some(
        (f) =>
          f.type === 'GENERAL_FLASH' &&
          f.spatial?.visualField?.exceedsThreshold === true,
      ),
      frameCount: samples.length,
      frameRate: 30,
      width: 1920,
      height: 1080,
      mediaFile,
      ...decoded,
      containerMatchesFirstEncounter: decoded.mediaSha256 === old.mediaSha256,
      findings: result.findings,
      quality: result.quality,
      engineStatus: result.status,
      analysisBackend: backendExecution(analyzer),
    });
  }
  const comparison = compareAlternatingBaseline(cases, baseline);
  assert.equal(
    await engineTreeHash(),
    engine,
    'Engine changed during regression',
  );
  assert.deepEqual(
    await detectionKernelIdentity(),
    kernel,
    'Kernel changed during regression',
  );
  await verifyAlternatingCorpus();
  await verifyAlternatingFirstEncounter();
  return {
    schemaVersion: 1,
    scope: 'KNOWN_ALTERNATING_COMPOSITION_REGRESSION',
    evaluatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    engineTreeSha256: engine,
    kernel,
    reference: {
      manifestSha256: FROZEN_MANIFEST_SHA256,
      firstEncounterSha256: FIRST_ENCOUNTER_SHA256,
      firstEncounterEngineSha256: baseline.engineTreeSha256,
    },
    harnessFiles: await Promise.all(
      [
        'validate-alternating-regression.mjs',
        'reference-ffv1.mjs',
        'validate-alternating-heldout.mjs',
        'validate-spatial-media.mjs',
        'validate-detection.mjs',
        'validate-expanded.mjs',
        'detection-kernel.mjs',
      ].map(async (path) => ({
        path,
        sha256: hash(await readFile(new URL(path, import.meta.url))),
      })),
    ),
    codec,
    sourceRendering:
      'Pinned opaque sRGBA source and PNG mask; regenerated FFV1, every source/decoded RGBA hash and PTS matches the immutable first encounter. Container hash is recorded separately because codec builds may produce different lossless bitstreams.',
    selectedInputs: 16,
    decodedFrames: cases.reduce((n, c) => n + c.frameCount, 0),
    jsonSummary: summarizeCases(
      cases.map((c) => ({
        expectedCandidate: c.jsonExpectedCandidate,
        observedCandidate: c.observedCandidate,
      })),
    ),
    csvSummary: summarizeCases(
      cases.map((c) => ({
        expectedCandidate: c.csvExpectedCandidate,
        observedCandidate: c.observedCandidate,
      })),
    ),
    baseline: comparison,
    passed: null,
    conformanceEstablished: false,
    scopeLimitations: baseline.scopeLimitations,
    cases,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const outputAt = process.argv.indexOf('--output'),
    mediaAt = process.argv.indexOf('--media-directory');
  assert.ok(
    outputAt >= 0 && process.argv[outputAt + 1],
    '--output is required; immutable first encounter is never replaced',
  );
  const output = process.argv[outputAt + 1],
    destination = await open(output, 'wx');
  try {
    const report = await validateAlternatingRegression({
      mediaDirectory: mediaAt >= 0 ? process.argv[mediaAt + 1] : undefined,
      progress: (message) => process.stderr.write(message + '\n'),
    });
    await destination.writeFile(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(
      JSON.stringify({
        output,
        engine: report.engineTreeSha256,
        baseline: report.baseline,
        jsonSummary: report.jsonSummary,
        frames: report.decodedFrames,
      }) + '\n',
    );
    if (report.baseline.status !== 'NO_NEW_MISMATCHES') process.exitCode = 2;
  } catch (error) {
    await destination.writeFile(
      JSON.stringify(
        {
          status: 'FAILED_INTEGRITY_OR_HARNESS',
          error: String(
            error instanceof Error ? (error.stack ?? error.message) : error,
          ),
        },
        null,
        2,
      ) + '\n',
    );
    process.stderr.write(
      String(error instanceof Error ? (error.stack ?? error.message) : error) +
        '\n',
    );
    process.exitCode = 1;
  } finally {
    await destination.close();
  }
}
