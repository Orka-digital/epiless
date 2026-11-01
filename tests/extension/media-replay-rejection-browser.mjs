import assert from 'node:assert/strict';

/** Assert that unsupported playback changes cannot produce replayable media evidence. */
export async function testMediaReplayRejection({
  loopPlan,
  page,
  request,
  segment,
  start,
  stop,
  sourceUrl,
  load,
  worker,
  tabId,
  mediaPlanFromEvidence,
}) {
  // Changed locator/rate, seek jumps, transient insertion and incomplete bounds
  // cannot become a comparable absence.
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.pause();
    v.playbackRate = 2;
  });
  assert.equal(
    (await request({ type: 'FG_MEDIA_REPLAY_PREPARE', mediaPlan: loopPlan }))
      .achieved,
    false,
  );
  await page.evaluate(() => (document.querySelector('video').playbackRate = 1));
  assert.equal(
    (await request({ type: 'FG_MEDIA_REPLAY_PREPARE', mediaPlan: loopPlan }))
      .achieved,
    true,
  );
  segment = await start();
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.currentTime = 0.3;
    const transient = document.createElement('video');
    document.body.append(transient);
    transient.remove();
  });
  await page.waitForTimeout(100);
  const mutated = await stop(segment);
  assert.equal(mutated.complete, false);
  assert.ok(mutated.reasons.includes('MEDIA_SEEK_DURING_OBSERVATION'));
  assert.ok(mutated.reasons.includes('MEDIA_MEMBERSHIP_CHANGED'));
  await page.evaluate((sourceUrl) => {
    document.querySelector('video').src = sourceUrl + '?changed';
  }, sourceUrl);
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  assert.equal(
    (await request({ type: 'FG_MEDIA_REPLAY_PREPARE', mediaPlan: loopPlan }))
      .achieved,
    false,
  );
  await request({ type: 'FG_RESTORE' });
  assert.equal(
    await page.evaluate(() => document.querySelector('video').paused),
    true,
  );

  // Restore preserves the original playback settings and never restarts playback.
  await load();
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.muted = false;
    v.currentTime = 0.4;
  });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  const restoreState = (await request({ type: 'FG_MEDIA_SNAPSHOT' })).items[0];
  const changed = structuredClone(restoreState);
  changed.timeMs = 1_000;
  assert.equal(
    (
      await request({
        type: 'FG_MEDIA_REPLAY_PREPARE',
        mediaPlan: {
          version: 1,
          status: 'REPLAYABLE',
          reasons: [],
          items: [changed],
        },
      })
    ).achieved,
    true,
  );
  await request({ type: 'FG_CANCEL' });
  await request({ type: 'FG_RESTORE' });
  assert.deepEqual(
    await page.evaluate(() => {
      const v = document.querySelector('video');
      return {
        paused: v.paused,
        muted: v.muted,
        time: v.currentTime,
        rate: v.playbackRate,
        loop: v.loop,
      };
    }),
    { paused: true, muted: false, time: 0.4, rate: 1, loop: false },
  );
  // A long-video metadata boundary is explicitly unsupported, never a
  // silently clamped, apparently exact 24-hour replay recipe.
  // A synthetic metadata edge case in the same isolated world as content;
  // this does not pretend to decode a 24-hour video.
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        func: () =>
          Object.defineProperty(document.querySelector('video'), 'duration', {
            value: 86400.001,
            configurable: true,
          }),
      }),
    tabId,
  );
  const overlong = await request({ type: 'FG_MEDIA_SNAPSHOT' });
  assert.equal(overlong.complete, false);
  assert.ok(overlong.reasons.includes('MEDIA_TIME_LIMIT_REACHED'));
  assert.equal(overlong.items[0].durationMs, null);
  assert.equal(
    (
      await request({
        type: 'FG_MEDIA_REPLAY_PREPARE',
        mediaPlan: {
          version: 1,
          status: 'REPLAYABLE',
          reasons: [],
          items: [restoreState],
        },
      })
    ).reason,
    'MEDIA_TIME_LIMIT_REACHED',
  );
  segment = await start();
  const overlongEvidence = await stop(segment);
  assert.equal(overlongEvidence.complete, false);
  assert.ok(overlongEvidence.reasons.includes('MEDIA_TIME_LIMIT_REACHED'));
  assert.equal(mediaPlanFromEvidence(overlongEvidence).status, 'UNSUPPORTED');
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => delete document.querySelector('video').duration,
      }),
    tabId,
  );
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++)
      document.body.append(document.createElement('video'));
  });
  assert.equal((await request({ type: 'FG_MEDIA_SNAPSHOT' })).complete, false);
}
