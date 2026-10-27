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
  encodedPageSource,
  encodedFrames,
  loadNativeEncodedAssets,
  sha256,
} from './native-encoded-source.mjs';
import { nativeLoopPage } from './native-loop-page.mjs';
import {
  nativeLoopCadencePage,
  LOOP_CADENCE_POLICY,
} from './native-loop-cadence-page.mjs';

const expectedPageModuleSha256 = sha256(
  await readFile(new URL('./native-loop-page.mjs', import.meta.url)),
);
const expectedCadenceModuleSha256 = sha256(
  await readFile(new URL('./native-loop-cadence-page.mjs', import.meta.url)),
);

export function verifyLoopFixtureIdentity(identity, source) {
  assert.equal(identity.source, 'EXISTING_FIXED_VP9_LOOP');
  assert.equal(
    identity.pageModuleSha256,
    expectedPageModuleSha256,
    'The retained page trace must identify this exact original fixture module.',
  );
  if (identity.cadenceVariant !== undefined) {
    assert.deepEqual(Object.keys(identity.cadenceVariant).sort(), [
      'moduleSha256',
      'policy',
    ]);
    assert.equal(
      identity.cadenceVariant.moduleSha256,
      expectedCadenceModuleSha256,
    );
    assert.deepEqual(identity.cadenceVariant.policy, LOOP_CADENCE_POLICY);
  }
  assert.equal(
    identity.servedHtmlSha256,
    sha256(
      identity.cadenceVariant === undefined
        ? nativeLoopPage(source)
        : nativeLoopCadencePage(source),
    ),
  );
}

/** Count only genuine end→start clock wraps, not arbitrary backwards seeks. */
export function independentWraps(samples, durationMs, rate) {
  assert.ok(Number.isFinite(rate) && rate > 0);
  assert.ok(Number.isFinite(durationMs) && durationMs > 500 * rate);
  assert.ok(
    samples.every(
      (sample) =>
        Number.isFinite(sample.atEpochMs) &&
        Number.isFinite(sample.timeMs) &&
        sample.timeMs >= 0 &&
        sample.timeMs <= durationMs + 2,
    ),
  );
  let wraps = 0;
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1],
      current = samples[i];
    assert.ok(current.atEpochMs >= previous.atEpochMs);
    assert.ok(
      current.atEpochMs - previous.atEpochMs <= 250,
      'Independent trace has a sampling gap.',
    );
    let advance = current.timeMs - previous.timeMs;
    if (current.timeMs + 2 < previous.timeMs) {
      assert.ok(
        previous.timeMs >= durationMs - 250 * rate &&
          current.timeMs <= 250 * rate,
        'A backwards seek away from the boundary is not a loop wrap.',
      );
      wraps++;
      advance += durationMs;
    }
    assert.ok(
      advance <= (current.atEpochMs - previous.atEpochMs) * rate + 80,
      'Independent trace skipped media positions; a large seek is not playback.',
    );
  }
  return wraps;
}

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
    const evidence = observation.mediaEvidence,
      item = evidence.items[0];
    const within = (sample) =>
      sample.atEpochMs >= evidence.startedEpochMs &&
      sample.atEpochMs <= evidence.endedEpochMs;
    const documents = environment.loopDocuments.filter((document) =>
      document.samples.some(within),
    );
    assert.equal(
      documents.length,
      1,
      'Independent document clocks must identify one measured page.',
    );
    const document = documents[0];
    assert.equal(document.sourceSha256, source.sourceSha256);
    assert.deepEqual(document.limitations, []);
    assert.ok(document.documentStartedEpochMs <= evidence.startedEpochMs);
    assert.ok(
      !document.events.some((event) =>
        ['ERROR', 'RVFC_UNAVAILABLE'].includes(event.kind),
      ),
    );
    const samples = document.samples.filter(within),
      presentations = document.presentations.filter(within);
    assert.ok(samples.length >= 40 && presentations.length >= 50);
    assert.ok(
      samples.every(
        (sample) =>
          sample.loop &&
          sample.playbackRate === 1 &&
          sample.rect.width === 64 &&
          sample.rect.height === 64,
      ),
    );
    const currentTimeWraps = independentWraps(samples, source.durationMs, 1);
    const presentedWraps = independentWraps(
      presentations,
      source.durationMs,
      1,
    );
    assert.ok(currentTimeWraps >= 1 && presentedWraps >= 1);
    for (const presentation of presentations) {
      assert.equal(presentation.videoWidth, 2);
      assert.equal(presentation.videoHeight, 2);
      const frame =
        source.frames[Math.round(presentation.timeMs / source.frameDurationMs)];
      assert.ok(
        frame && Math.abs(frame.timestampMs - presentation.timeMs) < 0.1,
        'Actual rVFC media positions must correspond to the immutable encoded frame timestamps.',
      );
    }
    let matchedPresentations = 0;
    for (const sample of item.samples) {
      if (!sample.presentation) continue;
      const atEpochMs = evidence.startedEpochMs + sample.atMs;
      assert.ok(
        presentations.some(
          (presented) =>
            Math.abs(presented.timeMs - sample.presentation.timeMs) < 0.1 &&
            presented.atEpochMs <= atEpochMs + 50 &&
            atEpochMs - presented.atEpochMs <= 250,
        ),
        'Observer presentation metadata must match an independently recorded page callback near that sample.',
      );
      matchedPresentations++;
    }
    assert.ok(matchedPresentations >= 40);
    independent = {
      documentId: document.documentId,
      currentTimeSamples: samples.length,
      presentations: presentations.length,
      currentTimeWraps,
      presentedWraps,
      matchedPresentations,
    };
  });
  check('native-capture-and-export', () => {
    const measured = observation.measurement,
      quality = measured.quality;
    assert.equal(quality.interrupted, false);
    assert.equal(quality.downsampled, false);
    assert.equal(quality.droppedFrames ?? 0, 0);
    assert.equal(quality.spatial.mode, 'NATIVE_PIXELS');
    assert.equal(quality.spatial.retainedResolutionRatio, 1);
    assert.ok(
      quality.frameCount >= 240 &&
        quality.effectiveFps >= 50 &&
        quality.maxGapMs <= 100,
    );
    assert.equal(
      quality.width,
      Math.round(
        observation.replay.viewport.width * observation.replay.viewport.dpr,
      ),
    );
    assert.equal(
      quality.height,
      Math.round(
        observation.replay.viewport.height * observation.replay.viewport.dpr,
      ),
    );
    assert.equal(quality.processing.measuredFrames, quality.frameCount);
    assert.notEqual(measured.status, 'INCONCLUSIVE');
    assert.equal(measured.passed, null);
    const scenario = report.routes
      .flatMap((route) => route.scenarios)
      .find((value) => value.id === observation.id);
    const coverage = report.routes
      .flatMap((route) => route.coverage ?? [])
      .find((value) => value.id === observation.id);
    assert.equal(coverage.outcome, 'TESTED');
    assert.equal(scenario.type, 'media-loop-boundary-1');
    assert.deepEqual(scenario.quality, quality);
    assert.equal(scenario.findings.length, measured.findings.length);
    assert.ok(
      !JSON.stringify(report).includes('"mediaEvidence"') &&
        !JSON.stringify(report).includes('"mediaPlan"'),
      'Local media recipes/locators must not leak into the shared report.',
    );
  });
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
