// Usage: node --import tsx tests/extension/verify-native-recheck.mjs \
//   baseline-local-job.json fixed-local-job.json recurrence-local-job.json
// Reads genuine native exports only; never generates substitute capture frames.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareVerification } from '../../apps/chrome-extension/src/verification.ts';

const filenames = process.argv.slice(2);
assert.equal(
  filenames.length,
  3,
  'Provide baseline, fixed and recurrence local-job exports.',
);
const [baseline, fixed, recurrence] = await Promise.all(
  filenames.map(async (filename) =>
    JSON.parse(await readFile(filename, 'utf8')),
  ),
);
let anchor, observed;
for (const task of baseline.tasks)
  for (const observation of task.observations) {
    if (observation.replay?.measuredStep === undefined) continue;
    const finding = observation.measurement?.findings.find(
      (value) => value.type === 'GENERAL_FLASH',
    );
    if (finding) {
      assert.equal(
        anchor,
        undefined,
        'Fixture must have one unambiguous triggered general candidate.',
      );
      anchor = {
        taskId: task.id,
        observationId: observation.id,
        findingId: finding.id,
      };
      observed = { observation, finding };
    }
  }
assert.ok(
  anchor,
  'Native source did not produce the tiny triggered candidate.',
);
assert.match(baseline.scannerBuildSha256, /^[a-f0-9]{64}$/);
assert.equal(fixed.scannerBuildSha256, baseline.scannerBuildSha256);
assert.equal(recurrence.scannerBuildSha256, baseline.scannerBuildSha256);
assert.equal(
  compareVerification(baseline, anchor, fixed).status,
  'NOT_OBSERVED',
);
assert.equal(
  compareVerification(baseline, anchor, recurrence).status,
  'REOBSERVED',
);
for (const job of [baseline, fixed, recurrence]) {
  const obs = job.tasks
    .flatMap((task) => task.observations)
    .find(
      (value) =>
        value.replay?.stateKey === observed.observation.replay.stateKey,
    );
  assert.ok(obs?.achieved, 'Same action/state must actually be reached.');
  const quality = obs.measurement.quality;
  assert.equal(quality.downsampled, false);
  assert.equal(quality.interrupted, false);
  assert.equal(quality.spatial.retainedResolutionRatio, 1);
  assert.ok(
    quality.width * quality.height >= 500_000,
    'Must exercise detailed native capture.',
  );
  assert.ok(quality.effectiveFps >= 50);
  assert.ok(quality.maxGapMs <= 100);
  assert.equal(quality.droppedFrames ?? 0, 0);
}
assert.ok(
  observed.finding.spatial?.simultaneousRatio < 0.001,
  'This fixture is deliberately tiny, not a large-area flash.',
);
assert.equal(observed.finding.sourceTimeline?.status, 'CORRELATED');
assert.ok(
  observed.finding.sourceTimeline.candidates.some((candidate) =>
    candidate.observations.some(
      (sample) =>
        sample.rect.x === 100 &&
        sample.rect.y === 240 &&
        sample.rect.width === 2 &&
        sample.rect.height === 2 &&
        sample.animations.some((animation) =>
          animation.properties.includes('backgroundColor'),
        ),
    ),
  ),
  'During-event evidence must include the actual tiny animated source.',
);
console.log(
  JSON.stringify(
    {
      scope:
        'One actual native tiny-detail control, same-build targeted fix and recurrence; no broad device or safety claim',
      scannerBuildSha256: baseline.scannerBuildSha256,
      baselineJobId: baseline.id,
      fixedJobId: fixed.id,
      recurrenceJobId: recurrence.id,
      anchor,
      fixed: 'NOT_OBSERVED',
      recurrence: 'REOBSERVED',
      source:
        'Tiny animated element present in during-event samples; correlation remains distinct from proven causality',
    },
    null,
    2,
  ),
);
