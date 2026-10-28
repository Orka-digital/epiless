// Genuine native exports only. This explicit video variant does not change the
// original CSS recheck verifier or the product comparison requirements.
// Usage: node --import tsx tests/extension/verify-native-media-recheck.mjs \
//   baseline-job baseline-env fixed-job fixed-env recurrence-job recurrence-env
import assert from 'node:assert/strict';

import { validPhaseEvidence } from '../../apps/chrome-extension/src/animation-phase.ts';

/** Reject incomplete or degraded native capture and require comparable phase and media evidence. */
export function assertRecheckCaptureQuality({
  observation,
  original,
  quality,
}) {
  assert.equal(observation.achieved, true);
  assert.equal(observation.replay.profile, 'current');
  assert.equal(observation.replay.viewportMethod, 'PHYSICAL');
  assert.deepEqual(observation.replay, original.observation.replay);
  assert.equal(quality.downsampled, false);
  assert.equal(quality.interrupted, false);
  assert.equal(quality.spatial.retainedResolutionRatio, 1);
  assert.ok(quality.width * quality.height >= 500000);
  assert.ok(quality.effectiveFps >= 50 && quality.maxGapMs <= 100);
  assert.equal(quality.droppedFrames ?? 0, 0);
  assert.ok(
    validPhaseEvidence(observation.phaseEvidence),
    'Current native acceptance requires actual document/animation clocks.',
  );
  assert.equal(observation.phaseEvidence.complete, true);
  assert.deepEqual(observation.phaseEvidence.reasons, []);
  assert.equal(observation.replay.phasePlan.status, 'REPLAYABLE');
  assert.equal(observation.mediaEvidence.complete, true);
  assert.deepEqual(observation.mediaEvidence.reasons, []);
  assert.equal(observation.mediaEvidence.items.length, 1);
  assert.equal(observation.replay.mediaPlan.status, 'REPLAYABLE');
}
