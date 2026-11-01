// Genuine native exports only. This explicit video variant does not change the
// original CSS recheck verifier or the product comparison requirements.
// Usage: node --import tsx tests/extension/verify-native-media-recheck.mjs \
//   baseline-job baseline-env fixed-job fixed-env recurrence-job recurrence-env
import assert from 'node:assert/strict';

import { measuredMediaInterval } from '../../apps/chrome-extension/src/media-replay.ts';

import { encodedSpec, sha256 } from './native-encoded-source.mjs';

import { recheckMediaPath } from './native-encoded-recheck-source.mjs';

/** Reject rechecks without continuous measured media clocks covering the replay interval. */
export function verifyRecheckMediaClock({ observation, job, original }) {
  const media = observation.mediaEvidence.items[0],
    before = media.before;
  assert.equal(before.sourceKind, 'URL');
  assert.equal(
    before.locatorSha256,
    sha256(new URL(recheckMediaPath, job.origin).href),
  );
  assert.equal(before.durationMs, encodedSpec.durationMs);
  assert.equal(before.timeMs, 0);
  assert.equal(before.playbackRate, 1);
  assert.equal(before.loop, false);
  assert.equal(before.paused, true);
  assert.deepEqual(before.seekable, [[0, encodedSpec.durationMs]]);
  assert.deepEqual(before, original.observation.mediaEvidence.items[0].before);
  const interval = measuredMediaInterval(media);
  assert.ok(
    interval,
    'Actual samples and compositor submissions must prove continuity.',
  );
  assert.equal(interval.startMs, 0);
  assert.equal(interval.endMs, encodedSpec.durationMs);
  const frames = media.presentations;
  assert.ok(frames.length >= 52 && frames.length <= 53);
  assert.ok(frames[0].timeMs === 0 || frames[0].timeMs === 40);
  assert.equal(frames.at(-1).timeMs, 2080);
  for (let n = 1; n < frames.length; n++) {
    assert.equal(frames[n].timeMs - frames[n - 1].timeMs, 40);
    assert.equal(frames[n].presentedFrames - frames[n - 1].presentedFrames, 1);
  }

  return { before, interval, frames };
}
