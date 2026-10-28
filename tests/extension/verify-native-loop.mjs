import { verifyLoopCaptureExport } from './native-loop-export-proof.mjs';
import { verifyIndependentLoop } from './native-loop-page-proof.mjs';
// Pure retained-evidence verification; no browser, capture or media generation.
// node --import tsx tests/extension/verify-native-loop.mjs local-job.json report.json environment.json [asset-directory]
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';

import { pathToFileURL } from 'node:url';

import {
  measuredMediaInterval,
  validMediaEvidence,
  validMediaPlan,
} from '../../apps/chrome-extension/src/media-replay.ts';

import { replayStateKey } from '../../apps/chrome-extension/src/verification.ts';

import {
  encodedFrames,
  encodedPageSource,
  loadNativeEncodedAssets,
  sha256,
} from './native-encoded-source.mjs';

import {
  independentWraps,
  verifyLoopFixtureIdentity,
} from './native-loop-provenance.mjs';

export function verifyNativeLoop(job, report, environment, assets) {
  const errors = [];
  const check = (scope, callback) => {
    try {
      callback();
    } catch (error) {
      errors.push({ scope, reason: String(error.message ?? error) });
    }
  };
  const source = encodedPageSource(assets, true);
  const observations = job.tasks?.flatMap((task) => task.observations) ?? [];
  const matches = observations.filter(
    (value) => value.scenario === 'media-loop-boundary-1',
  );
  const observation = matches[0];
  let interval,
    independent = {},
    localSamples = 0;
  check('immutable-source-and-build', () => {
    assert.equal(environment.headless, false);
    assert.equal(environment.emulateViewport, false);
    assert.equal(environment.pixelProbe, null);
    assert.equal(environment.denseProbe, null);
    verifyLoopFixtureIdentity(environment.loopFixture, source);
    assert.match(environment.extensionBuild.digest, /^[a-f0-9]{64}$/);
    assert.match(job.scannerBuildSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      environment.extensionBuild.embeddedScannerBuildSha256,
      job.scannerBuildSha256,
    );
    assert.equal(report.scannerBuildSha256, job.scannerBuildSha256);
    assert.equal(report.id, job.id);
    assert.equal(report.passed, null);
    assert.equal(
      environment.encodedSource.manifestSha256,
      assets.manifestSha256,
    );
    assert.deepEqual(environment.encodedSource.manifest, assets.manifest);
    assert.equal(environment.candidateFixture?.mode, 'NATIVE_ENCODED_LOOP');
    assert.equal(environment.candidateFixture.fixed, true);
    assert.equal(environment.candidateFixture.loop, true);
    assert.equal(environment.candidateFixture.dense, false);
    assert.deepEqual(environment.candidateFixture.encoded, source);
    assert.deepEqual(source.frames, encodedFrames(true));
  });
  check('autonomous-loop-recipe', () => {
    assert.equal(
      matches.length,
      1,
      'One unambiguous first loop observation is required.',
    );
    assert.equal(job.mode, 'AUTONOMOUS');
    assert.equal(observation.achieved, true);
    assert.equal(observation.coverage, 'TESTED');
    assert.equal(observation.reason, undefined);
    const recipe = observation.replay;
    assert.ok(recipe, 'A genuinely reached replay recipe must be retained.');
    assert.equal(recipe.stateKey, replayStateKey(recipe));
    assert.equal(recipe.durationMs, 5000);
    assert.equal(recipe.profile, 'current');
    const step = recipe.steps[recipe.measuredStep];
    assert.equal(step.kind, 'control');
    assert.equal(step.target.kind, 'media');
    assert.ok(validMediaPlan(recipe.mediaPlan));
    assert.equal(recipe.mediaPlan.status, 'REPLAYABLE');
    assert.equal(recipe.mediaPlan.items.length, 1);
    const selected = recipe.mediaPlan.items[0];
    assert.deepEqual(selected.selectorPath, step.target.selectorPath);
    assert.equal(selected.loop, true);
    assert.equal(selected.paused, false);
    assert.equal(selected.playbackRate, 1);
    assert.ok(Math.abs(selected.durationMs - source.durationMs) <= 1);
    assert.ok(
      Math.abs(
        selected.timeMs - (selected.durationMs - 1000 * selected.playbackRate),
      ) <= 2,
      'Prepared source position must be one playback-second before the finite end.',
    );
    assert.ok(
      selected.seekable.some(
        ([start, end]) =>
          start <= selected.timeMs && end >= selected.durationMs,
      ),
    );
    const route = new URL(recipe.route);
    assert.equal(route.hostname, '127.0.0.1');
    const locator = new URL(source.url, recipe.route).href;
    assert.equal(
      selected.locatorSha256,
      sha256(locator),
      'Locator identity is a URL hash, distinct from file bytes.',
    );
    assert.ok(
      observations.some(
        (value) =>
          value.scenario === 'media-loop-boundary-1-seek-transition' &&
          value.coverage === 'SKIPPED' &&
          value.reason === 'MEDIA_SEEK_PRECEDES_LOOP_MEASUREMENT',
      ),
    );
  });
  check('measured-media-loop', () => {
    const evidence = observation.mediaEvidence;
    assert.ok(validMediaEvidence(evidence));
    assert.equal(evidence.complete, true);
    assert.deepEqual(evidence.reasons, []);
    assert.ok(
      Number.isFinite(evidence.startedEpochMs) &&
        Number.isFinite(evidence.endedEpochMs),
    );
    assert.ok(evidence.startedEpochMs >= Date.parse(observation.startedAt));
    assert.ok(evidence.endedEpochMs <= Date.parse(observation.endedAt));
    assert.ok(evidence.endedEpochMs - evidence.startedEpochMs >= 4500);
    assert.equal(evidence.items.length, 1);
    const item = evidence.items[0],
      planned = observation.replay.mediaPlan.items[0];
    assert.deepEqual(item.before.selectorPath, planned.selectorPath);
    assert.equal(item.before.locatorSha256, planned.locatorSha256);
    assert.equal(item.before.sourceKind, 'URL');
    assert.equal(item.before.loop, true);
    assert.equal(item.after.loop, true);
    assert.equal(item.before.durationMs, planned.durationMs);
    assert.equal(item.after.durationMs, planned.durationMs);
    assert.equal(item.before.playbackRate, planned.playbackRate);
    assert.equal(item.after.playbackRate, planned.playbackRate);
    assert.ok(Math.abs(item.before.timeMs - planned.timeMs) <= 2);
    interval = measuredMediaInterval(item);
    assert.ok(
      interval,
      'Real time samples must prove a reproducible media interval.',
    );
    assert.ok(interval.wraps >= 1 && interval.presentedWraps >= 1);
    assert.ok(interval.presentations >= 50);
    const independentLocalWraps = independentWraps(
      item.samples.map((sample) => ({
        atEpochMs: evidence.startedEpochMs + sample.atMs,
        timeMs: sample.timeMs,
      })),
      item.before.durationMs,
      item.before.playbackRate,
    );
    assert.equal(independentLocalWraps, interval.wraps);
    assert.ok(
      item.samples.every((sample) => sample.loop && sample.playbackRate === 1),
    );
    const coverage = observation.replay.mediaPlan.coverage?.[0];
    assert.ok(
      coverage &&
        coverage.wraps === interval.wraps &&
        Math.abs(coverage.endMs - interval.endMs) <= 2,
    );
    localSamples = item.samples.length;
  });
  check('independent-page-clock-and-presentation', () => {
    independent = verifyIndependentLoop(
      observation,
      environment,
      source,
      assets,
    );
  });
  check('native-capture-and-export', () =>
    verifyLoopCaptureExport(observation, report, job),
  );
  return {
    scope:
      'One actual toolbar-started autonomous near-end observation of an existing seekable constant VP9 loop. Page clocks and rVFC independently confirm the boundary; no flash detection, whole-site, state-of-the-art, physical safety or frame-atomic attribution claim.',
    status: errors.length ? 'FAIL' : 'PASS',
    jobId: job.id,
    scannerBuildSha256: job.scannerBuildSha256,
    ...(environment.loopFixture?.cadenceVariant
      ? { cadenceVariant: environment.loopFixture.cadenceVariant }
      : {}),
    sourceSha256: source.sourceSha256,
    manifestSha256: assets.manifestSha256,
    scenario: observation?.scenario,
    achieved: observation?.achieved ?? false,
    coverage: observation?.coverage ?? null,
    mediaInterval: interval ?? null,
    localSamples,
    independentPageEvidence: independent,
    quality: observation?.measurement?.quality ?? null,
    wholeJobState: job.state,
    wholeReportStatus: report.status,
    passed: null,
    errors,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assert.ok(process.argv.length === 5 || process.argv.length === 6);
    const [job, report, environment, assets] = await Promise.all([
      ...process.argv
        .slice(2, 5)
        .map(async (name) => JSON.parse(await readFile(name, 'utf8'))),
      loadNativeEncodedAssets(process.argv[5]),
    ]);
    const result = verifyNativeLoop(job, report, environment, assets);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'PASS') process.exitCode = 2;
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          status: 'FAIL',
          errors: [
            {
              scope: 'input-or-source-validation',
              reason: String(error.message ?? error),
            },
          ],
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
  }
}
export {
  independentWraps,
  verifyLoopFixtureIdentity,
} from './native-loop-provenance.mjs';
