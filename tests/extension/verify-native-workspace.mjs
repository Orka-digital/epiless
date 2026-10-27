// Usage: node tests/extension/verify-native-workspace.mjs local-job.json environment.json
// Verifies retained real toolbar evidence; does not generate capture frames.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

assert.equal(
  process.argv.length,
  4,
  'Provide local job and environment exports.',
);
const [job, environment] = await Promise.all(
  process.argv
    .slice(2)
    .map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
);
const observations = job.tasks.flatMap((task) => task.observations);
const initial = observations.find(
  (observation) => observation.scenario === 'initial-viewport',
);
const compact = ['compact-viewport', 'compact-accordion'].map((scenario) => {
  const observation = observations.find((value) => value.scenario === scenario);
  assert.ok(observation?.achieved, `${scenario} must actually be reached.`);
  assert.equal(observation.coverage, 'TESTED');
  assert.equal(observation.replay.viewportMethod, 'PHYSICAL');
  const quality = observation.measurement.quality;
  assert.equal(quality.downsampled, false);
  assert.equal(quality.interrupted, false);
  assert.equal(quality.spatial.retainedResolutionRatio, 1);
  assert.ok(quality.effectiveFps >= 50 && quality.maxGapMs <= 100);
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
  return {
    scenario,
    frames: quality.frameCount,
    fps: quality.effectiveFps,
    width: quality.width,
    height: quality.height,
  };
});
for (const geometry of [initial.measurement.quality, compact[0]]) {
  for (const frameNumber of [1, 30, 120]) {
    const sample = environment.pixelProbe.samples.find(
      (value) =>
        value.width === geometry.width &&
        value.height === geometry.height &&
        value.frameNumber === frameNumber,
    );
    assert.ok(
      sample,
      `Missing corner probe ${geometry.width}x${geometry.height} frame ${frameNumber}`,
    );
    assert.equal(sample.colors.length, 4);
    for (let corner = 0; corner < 4; corner++)
      for (let channel = 0; channel < 4; channel++)
        assert.ok(
          Math.abs(
            sample.colors[corner][channel] -
              environment.pixelProbe.expectedColors[corner][channel],
          ) <= 4,
          'Captured corner differs from known page marker.',
        );
  }
}
const runtime = environment.runtime;
const states = runtime.focusTransitions;
assert.ok(states.length >= 3);
assert.equal(states[0].targetActive, false);
assert.equal(states[0].targetWindowFocused, true);
assert.ok(
  states.some(
    (state) =>
      state.targetActive &&
      !state.targetWindowFocused &&
      state.targetWindowId !== states[0].targetWindowId,
  ),
);
assert.ok(
  states.every((state) => !(state.targetActive && state.targetWindowFocused)),
);
assert.equal(runtime.targetActive, false);
assert.equal(runtime.window.id, states[0].targetWindowId);
assert.equal(runtime.foregroundTab, states[0].foregroundTabId);
assert.equal(runtime.window.width, environment.requestedWindow.width);
assert.equal(runtime.window.height, environment.requestedWindow.height);
assert.equal(runtime.debuggerAttached, false);
assert.equal(runtime.geometry.width, initial.replay.viewport.width);
assert.equal(runtime.geometry.height, initial.replay.viewport.height);
assert.equal(runtime.geometry.dpr, initial.replay.viewport.dpr);
console.log(
  JSON.stringify(
    {
      scope:
        'One actual PHYSICAL compact workspace: known sampled pixels, adequate compact cadence and sampled focus/restoration; no whole-job or device-matrix claim.',
      scannerBuildSha256: job.scannerBuildSha256,
      jobId: job.id,
      jobState: job.state,
      compact,
      cornerTolerancePerChannel: 4,
      focusEvidence:
        'One-second state-change samples; separate browser helper verifies activation/focus events.',
      restoration:
        'Original outer window and inactive target retained. CSS matches the debugger-attached measurement baseline; pre-start geometry after notice removal is not inferred.',
    },
    null,
    2,
  ),
);
