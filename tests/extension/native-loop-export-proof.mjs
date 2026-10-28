// Pure retained-evidence verification; no browser, capture or media generation.
// node --import tsx tests/extension/verify-native-loop.mjs local-job.json report.json environment.json [asset-directory]
import assert from 'node:assert/strict';

/** Require native capture quality and exact exported loop coverage. */
export function verifyLoopCaptureExport(observation, report) {
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
}
