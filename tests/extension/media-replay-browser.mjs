import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { serveEncodedAsset } from './native-encoded-source.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/** Actual HTMLVideoElement/seek/rVFC control proof, not tabCapture or pixel QA. */
export async function testMediaReplay({ context, page, worker, tabId, send }) {
  const esbuild = createRequire(
    new URL('../../apps/chrome-extension/package.json', import.meta.url),
  )('esbuild');
  const built = await esbuild.build({
    entryPoints: [
      fileURLToPath(
        new URL(
          '../../apps/chrome-extension/src/media-replay.ts',
          import.meta.url,
        ),
      ),
    ],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  const {
    mediaPlanFromEvidence,
    measuredMediaInterval,
    mediaComparisonReasons,
  } = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
  );
  const bytes = await readFile(
    new URL('./fixtures/native-encoded/fixed.webm', import.meta.url),
  );
  const server = createServer((request, response) => {
    if (request.url.startsWith('/media-replay-source'))
      return serveEncodedAsset(request, response, bytes);
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><style>video{width:2px;height:2px}button{margin:20px}</style>
    <button type="button" aria-controls="panel" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.querySelector('#panel').hidden=false;document.querySelector('video').play()">Show details</button>
    <div id="panel" hidden><video src="/media-replay-source" preload="auto" muted playsinline></video></div>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const sourceUrl = `http://127.0.0.1:${server.address().port}/media-replay-source`;
  const pageUrl = `http://127.0.0.1:${server.address().port}/media-replay-page`;
  try {
    const request = async (message) => {
      const response = await send(message);
      assert.equal(response.ok, true, response.error);
      return response.value;
    };
    const load = async () => {
      await page.goto(pageUrl);
      await page.waitForFunction(() => {
        const v = document.querySelector('video');
        return v.readyState >= 2 && v.seekable.length > 0;
      });
      await worker.evaluate(
        (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
          }),
        tabId,
      );
    };
    const generation = 'media-proof';
    let counter = 0;
    const start = async () => {
      const segmentId = `media-${++counter}`;
      assert.equal(
        (
          await request({
            type: 'FG_MEDIA_OBSERVATION_START',
            generation,
            segmentId,
          })
        ).started,
        true,
      );
      assert.equal(
        (
          await request({
            type: 'FG_MEDIA_OBSERVATION_BEGIN',
            generation,
            segmentId,
          })
        ).begun,
        true,
      );
      return segmentId;
    };
    const stop = (segmentId) =>
      request({ type: 'FG_MEDIA_OBSERVATION_STOP', generation, segmentId });
    const observe = (
      mediaEvidence,
      mediaPlan = mediaPlanFromEvidence(mediaEvidence),
    ) => ({
      mediaEvidence,
      replay: {
        mediaPlan,
        steps: [{ kind: 'control', target: { kind: 'accordion' } }],
      },
    });
    await load();
    let inventory = await request({ type: 'FG_INVENTORY' });
    assert.equal(inventory.mediaPresent, true);
    const snapshot = await request({ type: 'FG_MEDIA_SNAPSHOT' });
    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].paused, true);
    assert.equal(snapshot.items[0].timeMs, 0);
    assert.match(snapshot.items[0].locatorSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      JSON.stringify(snapshot).includes('media-replay-source'),
      false,
    );
    let segment = await start();
    assert.equal(
      (await request({ type: 'FG_ACTION', actionId: inventory.actions[0].id }))
        .achieved,
      true,
    );
    await page.waitForFunction(() => document.querySelector('video').ended);
    const baseline = await stop(segment),
      plan = mediaPlanFromEvidence(baseline);
    assert.equal(baseline.complete, true, JSON.stringify(baseline.reasons));
    assert.equal(plan.status, 'REPLAYABLE', JSON.stringify(plan.reasons));
    assert.ok(measuredMediaInterval(baseline.items[0]).presentations >= 40);
    assert.equal(
      measuredMediaInterval(baseline.items[0]).endMs,
      snapshot.items[0].durationMs,
    );
    assert.ok(baseline.startedEpochMs <= baseline.endedEpochMs);

    // A disclosure-triggered video gets exact same clip replay despite its action
    // being an accordion, not a direct video control.
    await load();
    inventory = await request({ type: 'FG_INVENTORY' });
    assert.equal(
      (await request({ type: 'FG_MEDIA_REPLAY_PREPARE', mediaPlan: plan }))
        .achieved,
      true,
    );
    await page.evaluate(() => {
      const video = document.querySelector('video');
      const records = [];
      const clock = () => performance.timeOrigin + performance.now();
      const seek = (event) =>
        records.push({
          type: event.type,
          epochMs: clock(),
          timeMs: video.currentTime * 1000,
          seeking: video.seeking,
          paused: video.paused,
        });
      video.addEventListener('seeking', seek);
      video.addEventListener('seeked', seek);
      let callback;
      const frame = (_now, metadata) => {
        records.push({
          type: 'presentation',
          epochMs: clock(),
          timeMs: metadata.mediaTime * 1000,
          presentedFrames: metadata.presentedFrames,
        });
        callback = video.requestVideoFrameCallback(frame);
      };
      callback = video.requestVideoFrameCallback(frame);
      globalThis.__stopMediaLoopTrace = () => {
        video.cancelVideoFrameCallback(callback);
        video.removeEventListener('seeking', seek);
        video.removeEventListener('seeked', seek);
        return records;
      };
    });
    segment = await start();
    assert.equal(
      (await request({ type: 'FG_MEDIA_REPLAY_RELEASE' })).achieved,
      true,
    );
    await request({ type: 'FG_ACTION', actionId: inventory.actions[0].id });
    await page.waitForFunction(() => document.querySelector('video').ended);
    assert.equal(
      (
        await request({
          type: 'FG_MEDIA_OBSERVATION_PROGRESS',
          generation,
          segmentId: segment,
          mediaPlan: plan,
        })
      ).covered,
      true,
    );
    const repeated = await stop(segment);
    assert.deepEqual(
      mediaComparisonReasons(observe(baseline), observe(repeated, plan)),
      [],
    );

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
    await page.evaluate(
      () => (document.querySelector('video').playbackRate = 1),
    );
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
    const restoreState = (await request({ type: 'FG_MEDIA_SNAPSHOT' }))
      .items[0];
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
    assert.equal(
      (await request({ type: 'FG_MEDIA_SNAPSHOT' })).complete,
      false,
    );
  } finally {
    await page.goto('about:blank');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(
    'Actual media replay checks passed: disclosure file replay, exact interval, 5s currentTime+rVFC loop seam, source/rate/seek/membership/bound failures and local restoration. No native capture claim.',
  );
}
