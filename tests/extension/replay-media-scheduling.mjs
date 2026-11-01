import assert from 'node:assert/strict';

import {
  measuredMediaInterval,
  mediaComparisonReasons,
  mediaPlanFromEvidence,
} from '../../apps/chrome-extension/src/media-replay.ts';

import { replayStateKey } from '../../apps/chrome-extension/src/verification.ts';

/** Assert media replay ordering and interval scheduling through the real background runner. */
export async function testMediaReplayScheduling({
  page,
  origin,
  worker,
  tab,
  baseline,
  run,
}) {
  // Real content + background + IndexedDB media recipe. Only pixel capture is
  // fake, so this proves ordering and interval preservation, never cadence.
  await page.goto(`${origin}/media`);
  await page.bringToFront(); // Fake capture cannot keep an inactive renderer's timers alive.
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }),
    tab.id,
  );
  const mediaSend = async (message) => {
    const response = await worker.evaluate(
      ({ tabId, message }) => chrome.tabs.sendMessage(tabId, message),
      { tabId: tab.id, message },
    );
    assert.equal(response.ok, true, response.error);
    return response.value;
  };
  const mediaInventory = await mediaSend({ type: 'FG_INVENTORY' });
  const mediaTrigger = {
    kind: 'control',
    target: mediaInventory.actions[0].target,
    expectedState: 'accordion:true:true',
  };
  const mediaBase = baseline('replay-media-reached', [mediaTrigger]);
  mediaBase.startUrl = `${origin}/media`;
  mediaBase.tasks[0].url = mediaBase.startUrl;
  const mediaObservation = mediaBase.tasks[0].observations[0];
  mediaObservation.replay.route = mediaBase.startUrl;
  mediaObservation.replay.viewport = mediaInventory.viewport;
  await mediaSend({
    type: 'FG_MEDIA_OBSERVATION_START',
    generation: 'fixture',
    segmentId: 'baseline',
  });
  await mediaSend({
    type: 'FG_MEDIA_OBSERVATION_BEGIN',
    generation: 'fixture',
    segmentId: 'baseline',
  });
  await mediaSend({ type: 'FG_ACTION', target: mediaTrigger.target });
  await page.waitForTimeout(1100);
  mediaObservation.mediaEvidence = await mediaSend({
    type: 'FG_MEDIA_OBSERVATION_STOP',
    generation: 'fixture',
    segmentId: 'baseline',
  });
  mediaObservation.replay.mediaPlan = mediaPlanFromEvidence(
    mediaObservation.mediaEvidence,
  );
  assert.equal(
    mediaObservation.replay.mediaPlan.status,
    'REPLAYABLE',
    JSON.stringify(mediaObservation.mediaEvidence),
  );
  mediaObservation.replay.stateKey = replayStateKey(mediaObservation.replay);
  const mediaRepeated = await run(mediaBase);
  const mediaActual = mediaRepeated.tasks
    .flatMap((task) => task.observations)
    .find((value) => value.scenario === 'targeted-recheck');
  assert.ok(mediaActual?.achieved, JSON.stringify(mediaRepeated));
  assert.equal(
    mediaActual.mediaEvidence.complete,
    true,
    JSON.stringify(mediaActual.mediaEvidence.reasons),
  );
  assert.equal(mediaActual.replay.stateKey, mediaObservation.replay.stateKey);
  assert.deepEqual(
    mediaComparisonReasons(mediaObservation, mediaActual),
    [],
    JSON.stringify({
      baseline: mediaObservation.mediaEvidence,
      repeated: mediaActual.mediaEvidence,
    }),
  );
  assert.ok(
    measuredMediaInterval(mediaActual.mediaEvidence.items[0]).presentations >
      20,
  );
  const mediaSegment = await worker.evaluate(
    (id) => globalThis.__segments.find((segment) => segment.id === id),
    mediaActual.id,
  );
  const mediaBounds = JSON.stringify({
    evidenceStart: mediaActual.mediaEvidence.startedEpochMs,
    evidenceEnd: mediaActual.mediaEvidence.endedEpochMs,
    segmentStart: mediaSegment.begunAt,
    segmentEnd: mediaSegment.endedAt,
  });
  assert.ok(
    mediaActual.mediaEvidence.startedEpochMs >= mediaSegment.begunAt,
    mediaBounds,
  );
  assert.ok(
    mediaActual.mediaEvidence.endedEpochMs <= mediaSegment.endedAt,
    mediaBounds,
  );
  const changedMedia = structuredClone(mediaBase);
  changedMedia.id = 'replay-media-mismatched';
  changedMedia.tasks[0].observations[0].replay.mediaPlan.items[0].locatorSha256 =
    'b'.repeat(64);
  changedMedia.tasks[0].observations[0].replay.stateKey = replayStateKey(
    changedMedia.tasks[0].observations[0].replay,
  );
  const failedMedia = await run(changedMedia);
  const mismatched = failedMedia.tasks
    .flatMap((task) => task.observations)
    .find((value) => value.scenario === 'targeted-recheck');
  assert.ok(
    mismatched?.measurement,
    'Failed preconditions must preserve separately measured pixel evidence',
  );
  assert.equal(mismatched.achieved, false);
  assert.equal(mismatched.coverage, 'UNREACHED');
  assert.equal(mismatched.mediaEvidence.complete, false);
  assert.ok(
    mismatched.mediaEvidence.reasons.includes(
      'MEDIA_REPLAY_PRECONDITION_UNREACHED',
    ),
  );
  assert.ok(
    mediaComparisonReasons(changedMedia.tasks[0].observations[0], mismatched)
      .length > 0,
  );
}
