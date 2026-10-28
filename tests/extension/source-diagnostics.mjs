import assert from 'node:assert/strict';
import { diagnosticFixtureHtml } from './source-diagnostic-page.mjs';
import { testDiagnosticInvalidation } from './source-diagnostics-invalidation.mjs';

/** Exercise current bundled content script in its actual Chrome isolated world. */
export async function testSourceDiagnostics({
  context,
  page,
  worker,
  tabId,
  send,
}) {
  await context.route('http://127.0.0.1:47820/diagnostic-source**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: diagnosticFixtureHtml,
    }),
  );
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(
    'http://127.0.0.1:47820/diagnostic-source?private-query#private-fragment',
  );
  const inject = () =>
    worker.evaluate(
      (tabId) =>
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        }),
      tabId,
    );
  await inject();
  const getContext = async () =>
    (await send({ type: 'FG_DIAGNOSTIC_CONTEXT' })).value;
  const expected = await getContext();
  assert.equal(expected.viewport.width, 800);
  assert.equal(expected.viewport.height, 600);
  assert.ok(expected.documentToken);
  const request = {
    expected,
    analysis: { width: 320, height: 240 },
    region: { x: 8, y: 8, width: 96, height: 48 },
  };
  const diagnose = async (change = {}) =>
    (
      await send({
        type: 'FG_DIAGNOSTIC_SOURCES',
        request: { ...request, ...change },
      })
    ).value;
  const canvas = await diagnose();
  assert.equal(canvas.status, 'MAPPED');
  assert.equal(canvas.coordinateSpace, 'CSS_VIEWPORT');
  assert.deepEqual(canvas.region, { x: 20, y: 20, width: 240, height: 120 });
  assert.equal(canvas.sampledPoints, 9);
  assert.equal(canvas.candidates.length, 1);
  assert.deepEqual(canvas.candidates[0], {
    selectorPath: ['*:nth-child(1) > *:nth-child(2) > *:nth-child(1)'],
    tag: 'canvas',
    rect: { x: 20, y: 20, width: 240, height: 120 },
    hitCount: 9,
    media: 'CANVAS',
    animation: { running: 1, paused: 1, finished: 0 },
  });
  assert.ok(
    canvas.limitations.includes(
      'POST_OBSERVATION_SPATIAL_HINT_NOT_VERIFIED_CAUSE',
    ),
  );
  assert.ok(
    canvas.limitations.includes('DOM_MAY_HAVE_CHANGED_SINCE_OBSERVED_FRAMES'),
  );

  const video = await diagnose({
    region: { x: 120, y: 8, width: 96, height: 48 },
  });
  assert.equal(video.candidates[0].media, 'VIDEO');
  assert.equal(video.candidates[0].tag, 'video');
  assert.equal(
    await page.evaluate(() => document.querySelector('video').paused),
    true,
  );
  const custom = await diagnose({
    region: { x: 232, y: 8, width: 72, height: 48 },
  });
  assert.equal(custom.candidates[0].tag, 'custom-element');
  const shadow = await diagnose({
    region: { x: 8, y: 72, width: 96, height: 48 },
  });
  assert.equal(shadow.candidates[0].media, 'CANVAS');
  assert.equal(shadow.candidates[0].selectorPath.length, 3);
  assert.equal(
    await page.evaluate(() => {
      const root = document.querySelector('x-private-shadow').shadowRoot;
      return root.querySelector('*:nth-child(2)') !== root.children[1];
    }),
    true,
    'Fixture exposes unanchored CSS ambiguity: a nested second child precedes the intended direct second child',
  );
  assert.equal(
    await page.evaluate((selectorPath) => {
      let root = document;
      let target;
      for (const [index, selector] of selectorPath.entries()) {
        for (const step of selector.split(' > ')) {
          const position = Number(/^\*:nth-child\((\d+)\)$/.exec(step)[1]);
          target = root.children[position - 1];
          root = target;
        }
        if (index < selectorPath.length - 1) root = target.shadowRoot;
      }
      return target?.id;
    }, shadow.candidates[0].selectorPath),
    'private-shadow-id',
    'Direct-child positional path resolves the actual nested shadow target despite earlier nested second-child decoys',
  );

  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'private-overlay';
    overlay.style.cssText =
      'position:fixed;left:20px;top:20px;width:240px;height:120px;background:#ccc;z-index:100';
    document.body.append(overlay);
  });
  const covered = await diagnose();
  assert.equal(covered.candidates.length, 1);
  assert.equal(covered.candidates[0].tag, 'div');
  assert.equal(
    covered.candidates[0].media,
    undefined,
    'No invented attribution to obscured canvas',
  );
  await page.evaluate(
    () =>
      (document.getElementById('private-overlay').style.pointerEvents = 'none'),
  );
  const pointerIgnored = await diagnose();
  assert.equal(pointerIgnored.candidates[0].media, 'CANVAS');
  assert.ok(
    pointerIgnored.limitations.includes(
      'HIT_TEST_OMITS_POINTER_EVENTS_NONE_AND_PSEUDO_ELEMENTS',
    ),
  );
  await page.evaluate(() =>
    document.getElementById('private-overlay').remove(),
  );

  await testDiagnosticInvalidation(
    page,
    diagnose,
    expected,
    request,
    getContext,
  );
  const serialized = JSON.stringify([
    canvas,
    video,
    custom,
    shadow,
    covered,
    pointerIgnored,
  ]);
  assert.ok(
    !serialized.includes('private-'),
    'No IDs, classes, text, custom names, URL parts or attributes leave the page',
  );
  assert.ok(
    !serialized.includes(expected.documentToken),
    'Ephemeral document identity is excluded from persisted result',
  );
  for (const result of [canvas, video, custom, shadow, covered, pointerIgnored])
    for (const candidate of result.candidates)
      for (const selector of candidate.selectorPath)
        assert.match(
          selector,
          /^\*:nth-child\(\d+\)( > \*:nth-child\(\d+\))*$/,
        );
  await page.evaluate(() => {
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 3; column++) {
        const tile = document.createElement('div');
        tile.className = 'private-grid';
        tile.style.cssText = `position:fixed;left:${20 + column * 80}px;top:${20 + row * 40}px;width:80px;height:40px;background:#aaa;z-index:100`;
        document.body.append(tile);
      }
  });
  const capped = await diagnose();
  assert.equal(capped.sampledPoints, 9);
  assert.equal(capped.candidates.length, 6);
  assert.ok(capped.limitations.includes('SPATIAL_CANDIDATE_LIMIT_REACHED'));
  await page.evaluate(() => {
    document.querySelectorAll('.private-grid').forEach((node) => node.remove());
    const parent = document.createElement('div');
    parent.id = 'private-deep';
    parent.style.cssText =
      'position:fixed;left:20px;top:20px;width:240px;height:120px;background:#aaa;z-index:100';
    document.body.append(parent);
    let current = parent;
    for (let depth = 0; depth < 40; depth++) {
      const child = document.createElement('div');
      child.style.cssText = 'width:100%;height:100%';
      current.append(child);
      current = child;
    }
  });
  const deep = await diagnose();
  assert.equal(deep.status, 'UNAVAILABLE');
  assert.deepEqual(deep.candidates, []);
  assert.ok(deep.limitations.includes('SPATIAL_SELECTOR_LIMIT_REACHED'));
  await page.evaluate(() => document.getElementById('private-deep').remove());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.waitForFunction(() => visualViewport.scale === 2);
  assert.equal((await diagnose()).reason, 'VIEWPORT_CHANGED');
  // The visualViewport property can change before its resize event updates the
  // content revision. Let those layout events settle before testing a stable
  // zoomed context; the preceding assertion separately tests the transition.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const zoomed = await getContext();
  assert.equal(
    (await diagnose({ expected: zoomed })).reason,
    'UNSUPPORTED_VIEWPORT_GEOMETRY',
    'Stable pinch zoom is not projected using unzoomed viewport coordinates',
  );
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await cdp.detach();
  await page.reload();
  await inject();
  assert.equal(
    (await diagnose()).reason,
    'DOCUMENT_CHANGED',
    'Same-URL reload cannot reuse old spatial context',
  );
  console.log(
    'Source diagnostic DOM checks passed: bounded read-only point sampling, nested shadow paths, canvas/video/animation descriptors, overlay honesty, privacy, region bounds and document/viewport/scroll/zoom mismatch rejection.',
  );
}
