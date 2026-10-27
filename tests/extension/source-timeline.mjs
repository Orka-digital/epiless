import assert from 'node:assert/strict';

/** Real Chrome isolated-world temporal diagnostics; all fixture colours stay static. */
export async function testSourceTimeline({
  context,
  page,
  worker,
  tabId,
  send,
}) {
  await context.route('http://127.0.0.1:47820/timeline-source**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><style>
      body{margin:0;min-height:2000px;background:#eee}video,canvas{position:fixed;display:block;width:240px;height:120px;background:#aaa;top:20px}
      video{left:20px}canvas{left:300px}x-private-shadow{position:fixed;left:20px;top:200px;width:240px;height:120px}
    </style></head><body>
      <video id="private-video" class="private-customer" data-src="https://private.test/private-asset"></video>
      <video id="presented-video" muted playsinline style="left:600px;width:60px;height:40px"></video>
      <canvas id="private-canvas">private-user-text</canvas><x-private-shadow></x-private-shadow>
      <script>
        const video=document.querySelector('video');video.currentTime=3;
        video.animate([{opacity:1},{opacity:1}],{duration:200,iterations:Infinity});
        const shadow=document.querySelector('x-private-shadow').attachShadow({mode:'open'});
        shadow.innerHTML='<canvas width="240" height="120" style="display:block;width:240px;height:120px;background:#aaa"></canvas>';
        shadow.querySelector('canvas').animate([{transform:'translateX(0)'},{transform:'translateX(0)'}],{duration:300,iterations:Infinity});
      </script>
    </body></html>`,
    }),
  );
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(
    'http://127.0.0.1:47820/timeline-source?private-query#private-fragment',
  );
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }),
    tabId,
  );
  const generation = 'timeline-test',
    segmentId = 'segment-1';
  assert.equal(
    (await send({ type: 'FG_SOURCE_TIMELINE_START', generation, segmentId }))
      .value.started,
    true,
  );
  const start = await page.evaluate(
    () => performance.timeOrigin + performance.now(),
  );
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#aaa';
    ctx.fillRect(0, 0, 8, 8);
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const video = document.querySelector('#presented-video');
    video.srcObject = stream;
    // The same static grey pixels are submitted every time. rVFC is genuinely
    // delivered by Chrome; no presentation metadata or media clock is mocked.
    globalThis.presentationTimer = setInterval(() => {
      ctx.fillRect(0, 0, 8, 8);
      track.requestFrame();
    }, 50);
    await video.play();
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    scrollTo(0, 500);
    document.querySelector('video').style.left = '30px';
  });
  await page.waitForTimeout(180);
  await page.evaluate(() => {
    document.querySelector('video').currentTime = 3.4;
  });
  await page.waitForTimeout(180);
  const end = await page.evaluate(
    () => performance.timeOrigin + performance.now(),
  );
  const event = {
    generation,
    segmentId,
    findingId: 'candidate-1',
    windowStartMs: 0,
    windowEndMs: end - start,
    windowStartEpochMs: start,
    windowEndEpochMs: end,
    clockBasis: 'FRAME_RECEIPT_ESTIMATE',
    alignmentUncertaintyMs: null,
    analysis: { width: 320, height: 240 },
    source: { width: 800, height: 600 },
    region: { x: 0, y: 0, width: 320, height: 240 },
  };
  assert.equal(
    (
      await send({
        type: 'FG_SOURCE_TIMELINE_EVENT',
        event: { ...event, generation: 'stale' },
      })
    ).value.recorded,
    false,
  );
  assert.equal(
    (await send({ type: 'FG_SOURCE_TIMELINE_EVENT', event })).value.recorded,
    true,
  );
  const timeline = (
    await send({ type: 'FG_SOURCE_TIMELINE_STOP', generation, segmentId })
  ).value['candidate-1'];
  assert.equal(timeline.status, 'CORRELATED');
  assert.equal(timeline.alignmentUncertaintyMs, null);
  assert.ok(
    timeline.limitations.includes(
      'TEMPORAL_SPATIAL_CORRELATION_NOT_VERIFIED_CAUSE',
    ),
  );
  const video = timeline.candidates.find(
    (candidate) =>
      candidate.media === 'VIDEO' &&
      candidate.observations.some((o) => o.animations.length),
  );
  assert.ok(video?.observations.length >= 3);
  assert.ok(video.observations.some((o) => o.viewport.scrollY === 0));
  assert.ok(video.observations.some((o) => o.viewport.scrollY === 500));
  assert.ok(
    video.observations.some((o) =>
      o.animations.some(
        (a) => a.durationMs === 200 && a.properties.includes('opacity'),
      ),
    ),
  );
  assert.ok(video.observations.some((o) => o.mediaTimeMs === 3000));
  assert.ok(video.observations.some((o) => o.mediaTimeMs === 3400));
  assert.ok(video.observations.some((o) => o.mutationsSincePrevious > 0));
  assert.ok(
    video.observations.some((o) => o.readWindow?.trigger === 'ANIMATION_FRAME'),
  );
  assert.ok(
    video.observations.every(
      (o) =>
        o.readWindow.startEpochMs <= o.readWindow.endEpochMs &&
        o.readWindow.endEpochMs <= o.atEpochMs,
    ),
  );
  const presented = timeline.candidates.find((candidate) =>
    candidate.observations.some((o) => o.videoPresentation),
  );
  assert.ok(
    presented,
    'Actual Chrome video callbacks retained separately from currentTime reads',
  );
  assert.ok(
    presented.observations.some(
      (o) => o.videoPresentation?.presentedFrames > 1,
    ),
  );
  assert.ok(
    presented.observations.every(
      (o) =>
        !o.videoPresentation ||
        o.videoPresentation.callbackEpochMs <= o.atEpochMs,
    ),
  );
  await page.evaluate(() => {
    clearInterval(globalThis.presentationTimer);
    for (const track of document
      .querySelector('#presented-video')
      .srcObject.getTracks())
      track.stop();
  });
  assert.ok(
    timeline.candidates.some(
      (candidate) =>
        candidate.selectorPath.length === 2 && candidate.media === 'CANVAS',
    ),
  );
  assert.equal(JSON.stringify(timeline).includes('private-'), false);
  assert.notEqual(
    video.id,
    video.inspectionToken,
    'Public candidate identity cannot reveal inspection capability',
  );
  const inspected = (
    await send({ type: 'FG_INSPECT_SOURCE', token: video.inspectionToken })
  ).value;
  assert.equal(inspected.status, 'AVAILABLE');
  assert.equal(inspected.tag, 'video');
  const bridge = await worker.evaluate(
    async ({ tabId, token }) => {
      return (
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (token) => {
            const element = globalThis.__flashguardInspectSource(token);
            return {
              tag: element?.localName,
              writable: Object.getOwnPropertyDescriptor(
                globalThis,
                '__flashguardInspectSource',
              ).writable,
            };
          },
          args: [token],
        })
      )[0].result;
    },
    { tabId, token: video.inspectionToken },
  );
  assert.deepEqual(bridge, { tag: 'video', writable: false });
  assert.equal(
    await page.evaluate(() => typeof globalThis.__flashguardInspectSource),
    'undefined',
    'Inspection bridge stays outside page main world',
  );
  await page.evaluate(() => {
    const video = document.querySelector('video');
    video.replaceWith(video.cloneNode(true));
  });
  assert.equal(
    (await send({ type: 'FG_INSPECT_SOURCE', token: video.inspectionToken }))
      .value.status,
    'UNAVAILABLE',
  );
  assert.equal(
    (await send({ type: 'FG_INSPECT_SOURCE', token: 'forged-token' })).value
      .status,
    'UNAVAILABLE',
  );
  await send({
    type: 'FG_SOURCE_TIMELINE_START',
    generation,
    segmentId: 'cancelled',
  });
  await send({ type: 'FG_CANCEL' });
  assert.deepEqual(
    (
      await send({
        type: 'FG_SOURCE_TIMELINE_STOP',
        generation,
        segmentId: 'cancelled',
      })
    ).value,
    {},
  );
}
