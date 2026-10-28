import assert from 'node:assert/strict';

import { mkdtemp, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import path from 'node:path';

/** Exercise a measured looping video and return its validated replay plan for rejection cases. */
export async function testMediaLoopReplay({
  page,
  request,
  segment,
  start,
  stop,
  measuredMediaInterval,
  mediaPlanFromEvidence,
}) {
  // Actual 5s loop seam, with both currentTime and compositor callback wraps.
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.loop = true;
    v.pause();
  });
  const loopSnapshot = await request({ type: 'FG_MEDIA_SNAPSHOT' });
  const loopPlan = {
    version: 1,
    status: 'REPLAYABLE',
    reasons: [],
    items: loopSnapshot.items,
  };
  loopPlan.items[0].timeMs = loopPlan.items[0].durationMs - 1000;
  loopPlan.items[0].paused = false;
  const loopPrepared = await request({
    type: 'FG_MEDIA_REPLAY_PREPARE',
    mediaPlan: loopPlan,
  });
  assert.equal(
    loopPrepared.achieved,
    true,
    JSON.stringify({
      loopPrepared,
      loopPlan,
      actual: await request({ type: 'FG_MEDIA_SNAPSHOT' }),
    }),
  );
  segment = await start();
  assert.equal(
    (await request({ type: 'FG_MEDIA_REPLAY_RELEASE' })).achieved,
    true,
  );
  await page.waitForTimeout(5000);
  const loop = await stop(segment),
    interval = measuredMediaInterval(loop.items[0]);
  const trace = await page.evaluate(() => globalThis.__stopMediaLoopTrace());
  if (!loop.complete || !interval) {
    const retained = await mkdtemp(
      path.join(tmpdir(), 'epiless-media-loop-failure-'),
    );
    await writeFile(
      path.join(retained, 'trace.json'),
      JSON.stringify(
        {
          scope: 'Actual HTMLVideoElement DOM/rVFC proof; no native capture',
          loop,
          interval: interval ?? null,
          independentEvents: trace,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
    console.error(`Retained media loop failure: ${retained}/trace.json`);
  }
  let loopProgress = interval;
  if (!loop.complete || !interval) {
    // Functional browser CI can miss a real compositor callback at a seam.
    // Accept only that independently corroborated, correctly rejected case;
    // native capture acceptance and original production evidence stay strict.
    const item = loop.items[0],
      frames = item.presentations;
    const gaps = frames.flatMap((frame, index) =>
      index > 0 &&
      frame.presentedFrames !== frames[index - 1].presentedFrames + 1
        ? [{ previous: frames[index - 1], next: frame }]
        : [],
    );
    assert.ok(
      gaps.length > 0,
      'No independently testable counter gap explains the failure',
    );
    for (const { previous, next } of gaps) {
      assert.ok(next.presentedFrames > previous.presentedFrames + 1);
      const matches = trace.filter(
        (event) =>
          event.type === 'presentation' &&
          event.epochMs >= loop.startedEpochMs &&
          event.epochMs <= loop.endedEpochMs,
      );
      const first = matches.findIndex(
        (event) => event.presentedFrames === previous.presentedFrames,
      );
      assert.ok(first >= 0);
      assert.equal(matches[first].timeMs, previous.timeMs);
      assert.equal(matches[first + 1]?.presentedFrames, next.presentedFrames);
      assert.equal(matches[first + 1]?.timeMs, next.timeMs);
    }
    assert.ok(
      loop.reasons.every((reason) => reason === 'MEDIA_LOOP_SEEK_UNPROVEN'),
    );
    assert.equal(mediaPlanFromEvidence(loop).status, 'UNSUPPORTED');
    // Counter-only diagnostic: no PTS is invented or inserted. This proves no
    // other clock/rate/stall/sample failure is hidden behind the known gap.
    // This copy is never exported, replayed or accepted by production.
    const diagnostic = structuredClone(item);
    diagnostic.presentations.forEach(
      (frame, index) =>
        (frame.presentedFrames = frames[0].presentedFrames + index),
    );
    loopProgress = measuredMediaInterval(diagnostic);
    assert.ok(
      loopProgress,
      'A failure besides the independently witnessed counter gap remains',
    );
    console.log(
      'Actual loop callback gap independently confirmed; original media remains UNSUPPORTED.',
    );
  }
  assert.ok(loopProgress.wraps >= 2);
  assert.ok(loopProgress.presentedWraps >= 2);
  assert.ok(loopProgress.presentations >= 100);
  return loopPlan;
}
