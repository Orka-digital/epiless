import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { testMediaLoopReplay } from './media-replay-loop-browser.mjs';
import { testMediaReplayRejection } from './media-replay-rejection-browser.mjs';
import { serveEncodedAsset } from './native-encoded-source.mjs';

/** Actual HTMLVideoElement/seek/rVFC control proof, not tabCapture or pixel QA. */
export async function testMediaReplay({ page, worker, tabId, send }) {
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

    const loopPlan = await testMediaLoopReplay({
      page,
      request,
      segment,
      start,
      stop,
      measuredMediaInterval,
      mediaPlanFromEvidence,
    });
    await testMediaReplayRejection({
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
    });
  } finally {
    await page.goto('about:blank');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(
    'Actual media replay checks passed: disclosure file replay, exact interval, 5s currentTime+rVFC loop seam, source/rate/seek/membership/bound failures and local restoration. No native capture claim.',
  );
}
