import assert from 'node:assert/strict';

import { interactiveFixture } from './interactive-fixture.mjs';

/** Exercise isolated-world controls, modal handling and reversible media actions; return live inspection helpers. */
export async function testInteractivePolicy({
  context,
  page,
  worker,
  tabId,
  send,
  inventory,
}) {
  // Exercise the actual isolated-world adapter against non-flashing DOM/media.
  await context.route('http://127.0.0.1:47820/interactive', (route) =>
    route.fulfill({ contentType: 'text/html', body: interactiveFixture() }),
  );
  await page.goto('http://127.0.0.1:47820/interactive');
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }),
    tabId,
  );
  const inspect = async () => (await send({ type: 'FG_INVENTORY' })).value;
  const act = async (kind) => {
    const snapshot = await inspect();
    const action = snapshot.actions.find(
      (candidate) => candidate.kind === kind,
    );
    assert.ok(action, `Expected supported ${kind}`);
    const result = (await send({ type: 'FG_ACTION', actionId: action.id }))
      .value;
    assert.equal(result.achieved, true, `${kind}: ${result.reason}`);
    return result;
  };
  inventory = await inspect();
  assert.deepEqual(
    inventory.actions.map((action) => action.kind),
    ['consent-reject'],
    'Known modal allows only its conservative reject adapter',
  );
  assert.ok(inventory.limitations.includes('HASH_ROUTER_ROUTES_UNOBSERVED'));
  assert.ok(!inventory.links.some((url) => url.includes('#/')));
  await act('consent-reject');
  assert.equal(await page.evaluate(() => window.rejects), 1);
  inventory = await inspect();
  assert.ok(
    !inventory.limitations.includes('MODAL_DIALOG_UNOBSERVED'),
    'Hidden modal must not block inspection',
  );
  assert.ok(
    !inventory.actions.some(
      (action) => action.kind === 'tab' || action.kind === 'media',
    ),
  );
  const menuId = inventory.actions.find((action) => action.kind === 'menu').id;
  await act('menu');
  inventory = await inspect();
  assert.equal(
    inventory.actions.find((action) => action.kind === 'menu').id,
    menuId,
    'Repeated inventory preserves attempted-control identity',
  );
  assert.ok(
    inventory.actions.some((action) => action.kind === 'tab'),
    'Opening a menu reveals a new supported tab',
  );
  await act('tab');
  inventory = await inspect();
  assert.ok(
    inventory.actions.some((action) => action.kind === 'media'),
    'Selecting a tab reveals a supported video',
  );
  await act('media');
  assert.deepEqual(
    await page.evaluate(() => {
      const v = document.querySelector('video');
      return {
        muted: v.muted,
        playing: !v.paused,
        progressed: v.currentTime > 0,
        audio: v.srcObject.getAudioTracks().length,
      };
    }),
    { muted: true, playing: true, progressed: true, audio: 0 },
  );
  await send({ type: 'FG_RESTORE' });
  assert.equal(
    await page.evaluate(() => document.querySelector('video').paused),
    true,
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('video').muted),
    false,
    'Original media mute state is restored without restarting playback',
  );
  await act('carousel');
  assert.equal(
    await page.evaluate(
      () => document.querySelectorAll('[aria-roledescription=slide]')[1].hidden,
    ),
    false,
  );
  await page.evaluate(() => {
    document.querySelector('#lazy-space + section')?.remove();
    scrollTo(0, 0);
    window.lazyAdded = false;
  });
  inventory = await inspect();
  const height = inventory.scrollHeight;
  await send({ type: 'FG_SCROLL', y: 900 });
  await page.waitForFunction(() => window.lazyAdded);
  inventory = await inspect();
  assert.ok(
    inventory.scrollHeight > height,
    'Fresh inventory sees lazy scroll growth',
  );
  assert.ok(inventory.links.some((url) => url.endsWith('/lazy-observed')));
  const discoveryScrollY = inventory.scrollY;
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.id = 'unknown-modal';
    d.innerHTML =
      '<button onclick="window.unknownClicked=true">Reject all</button>';
    document.body.append(d);
  });
  inventory = await inspect();
  assert.equal(
    inventory.actions.length,
    0,
    'Unknown modal is never dismissed by arbitrary text',
  );
  assert.ok(inventory.limitations.includes('MODAL_DIALOG_UNOBSERVED'));
  assert.equal(
    await page.evaluate(() => Boolean(window.unknownClicked)),
    false,
  );
  await page.evaluate(() => document.getElementById('unknown-modal').remove());
  assert.equal(
    (await send({ type: 'FG_NAVIGATE', url: 'https://outside.test/' })).value
      .initiated,
    false,
  );
  assert.equal(
    (await send({ type: 'FG_NAVIGATE', url: 'http://127.0.0.1:47820/logout' }))
      .value.initiated,
    false,
  );
  const navigation = (
    await send({
      type: 'FG_NAVIGATE',
      url: 'http://127.0.0.1:47820/spa/client',
    })
  ).value;
  assert.equal(navigation.initiated, true);
  assert.equal(page.url(), 'http://127.0.0.1:47820/spa/client');
  assert.equal(
    await page.evaluate(() => window.spaNavigations),
    1,
    'Real anchor interception uses pushState instead of a document request',
  );
  assert.equal((await inspect()).url, page.url());
  // Unexpected URL mutation is surfaced in the action response, never silently
  // attributed to the old route. Query/fragment secrets are stripped locally.
  await page.evaluate(() => {
    document.querySelector('main').innerHTML =
      '<button role="tab" aria-controls="route-panel">Route tab</button><div id="route-panel">Panel</div>';
    document.querySelector('[role=tab]').onclick = function () {
      this.setAttribute('aria-selected', 'true');
      history.pushState({}, '', '/tab-result?token=private#secret');
    };
  });
  const transition = await act('tab');
  assert.equal(transition.fromUrl, 'http://127.0.0.1:47820/spa/client');
  assert.equal(transition.url, 'http://127.0.0.1:47820/tab-result');
  assert.ok(!JSON.stringify(transition).includes('private'));
  // A fresh source document loses the dynamically inserted anchor. Replaying
  // its recorded scroll position must re-create it before link activation.
  await page.goto('http://127.0.0.1:47820/interactive');
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }),
    tabId,
  );
  assert.ok(
    !(await inspect()).links.some((url) => url.endsWith('/lazy-observed')),
  );
  await act('consent-reject');
  assert.equal(
    (
      await send({
        type: 'FG_NAVIGATE',
        url: 'http://127.0.0.1:47820/lazy-observed',
      })
    ).value.initiated,
    false,
  );
  assert.equal(
    (await send({ type: 'FG_SCROLL', y: discoveryScrollY })).value.achieved,
    true,
  );
  await page.waitForFunction(() => window.lazyAdded);
  assert.ok(
    (await inspect()).links.some((url) => url.endsWith('/lazy-observed')),
  );
  const lazyNavigation = page.waitForURL(
    'http://127.0.0.1:47820/lazy-observed',
  );
  await send({
    type: 'FG_NAVIGATE',
    url: 'http://127.0.0.1:47820/lazy-observed',
  }).catch((error) =>
    assert.match(String(error), /message port|channel|receiving/i),
  );
  await lazyNavigation;

  return { inspect, act };
}
