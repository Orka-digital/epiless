import assert from 'node:assert/strict';

import { shadowFixture } from './shadow-fixture.mjs';

/** Assert conservative control discovery and execution across open shadow roots. */
export async function testShadowPolicy({
  context,
  page,
  worker,
  tabId,
  inventory,
  inspect,
  send,
  act,
}) {
  await context.route('http://127.0.0.1:47820/shadow-components', (route) =>
    route.fulfill({ contentType: 'text/html', body: shadowFixture() }),
  );
  await page.goto('http://127.0.0.1:47820/shadow-components');
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }),
    tabId,
  );
  inventory = await inspect();
  assert.deepEqual(
    inventory.actions.map((action) => action.kind),
    ['menu', 'accordion', 'accordion'],
    'Open nested components are discovered, while form/inert/transparent hosts and nested sensitive panels stay excluded',
  );
  assert.ok(inventory.limitations.includes('LOGIN_OR_CAPTCHA_UNOBSERVED'));
  const shadowMenu = inventory.actions.find((action) => action.kind === 'menu');
  // aria-controls must resolve in its own root even when the document duplicates its ID.
  await page.evaluate(() =>
    document
      .querySelector('x-shell')
      .shadowRoot.querySelector('[role=button]')
      .setAttribute('aria-expanded', 'true'),
  );
  const missingPanel = (
    await send({ type: 'FG_ACTION', actionId: shadowMenu.id })
  ).value;
  assert.equal(
    missingPanel.achieved,
    false,
    'A visible same-ID light-DOM panel cannot fake shadow coverage',
  );
  await page.evaluate(() =>
    document
      .querySelector('x-shell')
      .shadowRoot.querySelector('[role=button]')
      .setAttribute('aria-expanded', 'false'),
  );
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'opaque-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:#ddd;z-index:2147483647';
    document.body.append(overlay);
  });
  const obscured = (await send({ type: 'FG_ACTION', actionId: shadowMenu.id }))
    .value;
  assert.equal(obscured.achieved, false);
  assert.equal(obscured.reason, 'CONTROL_OBSCURED');
  assert.equal(
    await page.evaluate(() => window.menuClicks),
    0,
    'Synthetic clicks never pass through an unlabeled overlay',
  );
  await page.evaluate(() => document.getElementById('opaque-overlay').remove());
  await act('menu');
  await act('tab');
  await act('media');
  assert.deepEqual(
    await page.evaluate(() => {
      const video = document
        .querySelector('x-shell')
        .shadowRoot.querySelector('x-content')
        .shadowRoot.querySelector('video');
      return {
        playing: !video.paused,
        muted: video.muted,
        guardClicks: window.guardClicks,
        menuClicks: window.menuClicks,
        tabClicks: window.tabClicks,
      };
    }),
    { playing: true, muted: true, guardClicks: 0, menuClicks: 1, tabClicks: 1 },
  );
  await send({ type: 'FG_RESTORE' });
  inventory = await inspect();
  assert.ok(inventory.links.some((url) => url.endsWith('/shadow-route')));
  const deceptive = inventory.actions.find(
    (action) => action.kind === 'accordion',
  );
  const hiddenPanel = (
    await send({ type: 'FG_ACTION', actionId: deceptive.id })
  ).value;
  assert.equal(
    hiddenPanel.achieved,
    false,
    'An opacity-zero ancestor prevents a false achieved panel state',
  );
  assert.equal(hiddenPanel.reason, 'CONTROL_STATE_NOT_CONFIRMED');
  const offscreen = inventory.actions.filter(
    (action) => action.kind === 'accordion',
  )[1];
  const outsideViewport = (
    await send({ type: 'FG_ACTION', actionId: offscreen.id })
  ).value;
  assert.equal(
    outsideViewport.achieved,
    false,
    'Expanding an offscreen panel is not observed viewport coverage',
  );
  assert.equal(outsideViewport.reason, 'CONTROL_STATE_NOT_CONFIRMED');
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'opaque-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:#ddd;z-index:2147483647';
    document.body.append(overlay);
  });
  const blockedLink = (
    await send({
      type: 'FG_NAVIGATE',
      url: 'http://127.0.0.1:47820/shadow-route',
    })
  ).value;
  assert.equal(blockedLink.initiated, false);
  assert.equal(blockedLink.reason, 'NAVIGATION_LINK_OBSCURED');
  assert.equal(await page.evaluate(() => window.shadowNavigations), 0);
  await page.evaluate(() => document.getElementById('opaque-overlay').remove());
  const shadowNavigation = (
    await send({
      type: 'FG_NAVIGATE',
      url: 'http://127.0.0.1:47820/shadow-route',
    })
  ).value;
  assert.equal(shadowNavigation.initiated, true);
  assert.equal(await page.evaluate(() => window.shadowNavigations), 1);
  assert.equal(page.url(), 'http://127.0.0.1:47820/shadow-route');
  await page.evaluate(() => {
    for (let index = 0; index < 70; index++) {
      const host = document.createElement('x-limit');
      host.attachShadow({ mode: 'open' }).innerHTML = '<span>Bounded</span>';
      document.body.append(host);
    }
  });
  assert.ok(
    (await inspect()).limitations.includes(
      'SHADOW_ROOT_DISCOVERY_LIMIT_REACHED',
    ),
  );
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 12001; index++)
      fragment.append(document.createElement('span'));
    document.body.append(fragment);
  });
  inventory = await inspect();
  assert.ok(inventory.limitations.includes('DOM_DISCOVERY_LIMIT_REACHED'));
  assert.equal(
    inventory.actions.length,
    0,
    'Incomplete safety traversal fails closed for active controls',
  );
  const incompleteNavigation = (
    await send({
      type: 'FG_NAVIGATE',
      url: 'http://127.0.0.1:47820/shadow-route',
    })
  ).value;
  assert.equal(incompleteNavigation.initiated, false);
  assert.equal(incompleteNavigation.reason, 'NAVIGATION_DISCOVERY_INCOMPLETE');
  assert.equal(await page.evaluate(() => window.shadowNavigations), 1);
  // A previously complete tree can grow while scrollIntoView runs. Re-check
  // the traversal budget immediately before activating the original anchor.
  await page.evaluate(() => {
    for (const host of document.querySelectorAll('x-limit')) host.remove();
    for (const span of document.body.querySelectorAll(':scope > span'))
      span.remove();
    scrollTo(0, 0);
    const link = document.createElement('a');
    link.id = 'growing-navigation';
    link.href = '/after-growth';
    link.textContent = 'More documentation';
    link.style.cssText = 'display:block;margin-top:2500px';
    link.onclick = (event) => {
      event.preventDefault();
      window.shadowNavigations++;
    };
    document.body.append(link);
    addEventListener('scroll', () => {
      if (scrollY < 1000 || window.navigationGrowth) return;
      window.navigationGrowth = true;
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 12001; index++)
        fragment.append(document.createElement('span'));
      document.body.append(fragment);
    });
  });
  const growingNavigation = (
    await send({
      type: 'FG_NAVIGATE',
      url: 'http://127.0.0.1:47820/after-growth',
    })
  ).value;
  assert.equal(
    await page.evaluate(() => Boolean(window.navigationGrowth)),
    true,
  );
  assert.equal(growingNavigation.initiated, false);
  assert.equal(growingNavigation.reason, 'NAVIGATION_DISCOVERY_INCOMPLETE');
  assert.equal(await page.evaluate(() => window.shadowNavigations), 1);
}
