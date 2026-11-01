import { engineSourceIdentity } from '../packages/analysis-engine/scripts/source-identity.mjs';

import { createHash } from 'node:crypto';

import { readFile } from 'node:fs/promises';

import { isAbsolute, relative, resolve } from 'node:path';

import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  backendExecution,
  detectionKernelIdentity,
} from './detection-kernel.mjs';

import {
  ENGINE_VERSION,
  FrameAnalyzer,
} from '../packages/analysis-engine/src/index.ts';
import {
  compareBaseline,
  parseSamples,
  summarizeCases,
} from './detection-summary.mjs';

const fixtureRoot = fileURLToPath(
  new URL('../tests/reference/trace-pse/', import.meta.url),
);

export async function validateDetection(
  root = fixtureRoot,
  { expandedSource = false } = {},
) {
  /** @type {import("./helper-types.js").TemporalManifest} */
  const manifest = JSON.parse(
    (await readFile(resolve(root, 'manifest.json'), 'utf8')).toString(),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.upstreamRepository !==
      'https://github.com/traceRERC/pse-test-media' ||
    !/^[a-f0-9]{40}$/.test(manifest.upstreamCommit) ||
    manifest.license !== 'BSD-3-Clause' ||
    !Array.isArray(manifest.files)
  )
    throw new Error('Invalid reference manifest');
  const upstream = resolve(root, 'upstream');
  const kernel = await detectionKernelIdentity();
  const seen = new Set();
  /** @type {import("./helper-types.js").DetectionCase[]} */
  const cases = [];
  const unscored = [];
  for (const fixture of manifest.files) {
    const file = resolve(upstream, fixture.path);
    const rel = relative(upstream, file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || seen.has(rel))
      throw new Error('Invalid or duplicate reference path');
    if (
      fixture.sourceUrl !==
      `${manifest.upstreamRepository}/blob/${manifest.upstreamCommit}/${fixture.path}`
    )
      throw new Error(
        'Reference source URL is not pinned to the manifest commit',
      );
    seen.add(rel);
    const bytes = await readFile(file);
    const gitBlobSha1 = createHash('sha1')
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest('hex');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (gitBlobSha1 !== fixture.gitBlobSha1 || sha256 !== fixture.sha256)
      throw new Error(`Reference integrity mismatch: ${fixture.path}`);
    if (fixture.kind === 'provenance') continue;
    if (
      !['GENERAL_FLASH', 'RED_FLASH'].includes(fixture.kind) ||
      fixture.framesPerSecond !== 30 ||
      typeof fixture.expectedCandidate !== 'boolean' ||
      fixture.expectedCandidate !==
        fixture.path.split('/').at(-1)?.startsWith('f') ||
      (fixture.kind === 'GENERAL_FLASH') !==
        fixture.path.startsWith('lum_flash_patterns/rel_lum/')
    )
      throw new Error(`Invalid reference case: ${fixture.path}`);
    let samples;
    try {
      samples = parseSamples(bytes.toString('utf8'), {
        allowZeroBased: expandedSource,
      });
    } catch (error) {
      if (!expandedSource) throw error;
      unscored.push({
        id: fixture.path,
        expectedCandidate: fixture.expectedCandidate,
        reason: String(error),
      });
      continue;
    }
    const analyzer = new FrameAnalyzer();
    samples.forEach((rgba, index) => {
      analyzer.pushFrame({
        rgba,
        width: 1,
        height: 1,
        timestampMs: (index * 1000) / fixture.framesPerSecond,
      });
    });
    const result = analyzer.finish();
    const candidates = result.findings.filter(
      (finding) => finding.type === fixture.kind,
    );
    cases.push({
      id: fixture.path,
      kind: fixture.kind,
      frames: samples.length,
      expectedCandidate: fixture.expectedCandidate,
      observedCandidate: candidates.length > 0,
      agreement: fixture.expectedCandidate === candidates.length > 0,
      engineStatus: result.status,
      analysisBackend: backendExecution(analyzer),
      candidates: candidates.map(({ startMs, endMs }) => ({ startMs, endMs })),
      otherCandidateTypes: [
        ...new Set(result.findings.map((finding) => finding.type)),
      ]
        .filter((type) => type !== fixture.kind)
        .sort(),
    });
  }
  if (!cases.length) throw new Error('Reference manifest has no cases');
  const overall = summarizeCases(cases);
  const manifestSha256 = createHash('sha256')
    .update(await readFile(resolve(root, 'manifest.json')))
    .digest('hex');
  if (
    JSON.stringify(kernel) !== JSON.stringify(await detectionKernelIdentity())
  )
    throw new Error(
      'Kernel source or packaged bytes changed during validation',
    );
  return {
    schemaVersion: 1,
    kernel,
    engineVersion: ENGINE_VERSION,
    engineSourceTree: await engineSourceIdentity(),
    engineSourceSha256: createHash('sha256')
      .update(
        await readFile(
          new URL('../packages/analysis-engine/src/index.ts', import.meta.url),
        ),
      )
      .digest('hex'),
    reference: {
      repository: manifest.upstreamRepository,
      commit: manifest.upstreamCommit,
      license: manifest.license,
      manifestSha256,
      filesVerified: manifest.files.length,
    },
    scope: 'NUMERIC_TEMPORAL_INTENSITY_PROJECTION',
    verdict: overall.mismatches ? 'MISMATCHES' : 'ALL_SELECTED_CASES_AGREE',
    conformanceEstablished: false,
    methodology:
      'Verbatim external sRGBA samples at upstream 30 fps, projected onto one pixel. Compare only the named luminance or red candidate channel with the upstream filename label. No synthesized padding or rendered media.',
    unsupported: [
      'Spatial masks, combined concurrent area and WCAG 10-degree visual-field thresholds',
      'Fine patterns and motion compensation',
      'Browser capture, downsampling, frame loss and display conditions',
      'HDR, wide gamut and colour-management accuracy',
      'Clinical safety, real-world accuracy and overall WCAG conformance',
    ],
    overall,
    ...(expandedSource
      ? { sourceCases: cases.length + unscored.length, unscored }
      : {}),
    byType: Object.fromEntries(
      ['GENERAL_FLASH', 'RED_FLASH'].map((kind) => [
        kind,
        summarizeCases(cases.filter((item) => item.kind === kind)),
      ]),
    ),
    cases,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--require-match', '--check-baseline'].includes(arg))
  )
    throw new Error(
      'Usage: node --import tsx scripts/validate-detection.mjs [--check-baseline] [--require-match]',
    );
  /** @type {Awaited<ReturnType<typeof validateDetection>> & {baselineComparison?: ReturnType<typeof compareBaseline>}} */
  const report = await validateDetection();
  if (args.includes('--check-baseline')) {
    const baseline = JSON.parse(
      (
        await readFile(resolve(fixtureRoot, 'comparison-0.3.0.json'), 'utf8')
      ).toString(),
    );
    report.baselineComparison = compareBaseline(report, baseline);
    if (report.baselineComparison.newMismatches.length) process.exitCode = 2;
  }
  console.log(JSON.stringify(report, null, 2));
  if (args.includes('--require-match') && report.overall.mismatches)
    process.exitCode = 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main().catch((error) => {
    console.error(
      `Detection reference validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
export {
  compareBaseline,
  parseSamples,
  summarizeCases,
} from './detection-summary.mjs';
