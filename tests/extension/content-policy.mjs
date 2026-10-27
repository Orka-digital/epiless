import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { interactiveFixture } from './interactive-fixture.mjs';
import { shadowFixture } from './shadow-fixture.mjs';
import { testSourceDiagnostics } from './source-diagnostics.mjs';
import { testSourceTimeline } from './source-timeline.mjs';
import { testScenarioControls } from './scenario-controls.mjs';
import { testMediaReplay } from './media-replay-browser.mjs';

const directory = await mkdtemp(
  path.join(tmpdir(), 'flashguard-content-policy-'),
);
const extension = path.join(directory, 'extension');
await cp(
  fileURLToPath(new URL('../../apps/chrome-extension/dist/', import.meta.url)),
  extension,
  { recursive: true },
);
// Compile the current adapter into this disposable copy; never let a stale dist
// artifact make DOM safety regressions pass, and never mutate the developer build.
const requireExtension = createRequire(
  new URL('../../apps/chrome-extension/package.json', import.meta.url),
);
await requireExtension('esbuild').build({
  entryPoints: [
    fileURLToPath(
      new URL('../../apps/chrome-extension/src/content.ts', import.meta.url),
    ),
  ],
  outfile: path.join(extension, 'content.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome116',
});
await requireExtension('esbuild').build({
  stdin: {
    contents: `import { trustedHover } from './trusted-pointer'; globalThis.__testTrustedHover = async (tabId, target) => trustedHover({ enabled: true, tabId, target, guard: async () => {}, request: async (type, target) => { const result = await chrome.tabs.sendMessage(tabId, { type, target }); if (!result.ok) throw new Error(result.error); return result.value; } });`,
    resolveDir: fileURLToPath(
      new URL('../../apps/chrome-extension/src/', import.meta.url),
    ),
  },
  outfile: path.join(extension, 'trusted-hover-test.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome116',
});
await writeFile(
  path.join(extension, 'trusted-hover-test.html'),
  '<!doctype html><script src="trusted-hover-test.js"></script><p>Isolated native pointer test</p>',
);
const manifest = JSON.parse(
  await readFile(path.join(extension, 'manifest.json'), 'utf8'),
);
assert.equal(
  manifest.host_permissions,
  undefined,
  'Production must not pre-grant website access',
);
// This isolated DOM-adapter test pre-grants only its local fixture host. The native
// toolbar test separately checks the real production optional-permission flow.
manifest.host_permissions = ['http://127.0.0.1/*'];
// Only this disposable advanced-interaction fixture grants debugger access.
manifest.permissions = [...new Set([...manifest.permissions, 'debugger'])];
await writeFile(
  path.join(extension, 'manifest.json'),
  JSON.stringify(manifest),
);
let context;
try {
  context = await chromium.launchPersistentContext(
    path.join(directory, 'profile'),
    {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  await context.route('http://127.0.0.1:47820/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><style>button,input{display:block;margin:20px}#mutable{margin-top:2000px}</style>
    <form id="paymentform" action="/submit" onsubmit="event.preventDefault();window.submits++"></form>
    <button id="safe" type="button" aria-controls="panel" aria-expanded="false" onclick="window.safeClicks++;this.setAttribute('aria-expanded','true')">Show details</button><div id="panel">Safe disclosure</div>
    <button form="paymentform" aria-controls="panel" aria-expanded="false">Show details</button>
    <input type="image" role="tab" aria-controls="panel" form="paymentform" alt="details">
    <button type="button" aria-controls="authpanel" aria-expanded="false" onclick="window.authClicks++">Show details</button><div id="authpanel"><input type="password"></div>
    <button id="mutable" type="button" aria-controls="panel" aria-expanded="false" onclick="window.unsafeClicks++">Show more detail</button>
    <script>window.submits=0;window.safeClicks=0;window.authClicks=0;window.unsafeClicks=0;addEventListener('scroll',()=>{if(scrollY>1000){const button=document.getElementById('mutable');button.setAttribute('form','paymentform');button.type='submit'}})</script>`,
    }),
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:47820/');
  const tabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ url: 'http://127.0.0.1:47820/*' }))[0].id,
  );
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }),
    tabId,
  );
  const send = (message) =>
    worker.evaluate(
      ({ tabId, message }) => chrome.tabs.sendMessage(tabId, message),
      { tabId, message },
    );
  let inventory = (await send({ type: 'FG_INVENTORY' })).value;
  assert.equal(
    inventory.actions.length,
    2,
    'Linked forms, input-image submitters and password panels must be excluded',
  );
  const mutable = inventory.actions[1];
  const safe = inventory.actions[0];
  assert.equal(
    (await send({ type: 'FG_ACTION', actionId: safe.id })).value.achieved,
    true,
  );
  const mutation = await send({ type: 'FG_ACTION', actionId: mutable.id });
  assert.equal(
    mutation.value.achieved,
    false,
    'A scroll-mutated submit control must not execute',
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      safe: window.safeClicks,
      submits: window.submits,
      auth: window.authClicks,
      unsafe: window.unsafeClicks,
    })),
    { safe: 1, submits: 0, auth: 0, unsafe: 0 },
  );
  await page.evaluate(() => {
    scrollTo(0, 0);
    document.getElementById('safe').setAttribute('aria-expanded', 'false');
  });
  inventory = (await send({ type: 'FG_INVENTORY' })).value;
  const cancelled = await worker.evaluate(
    async ({ tabId, actionId }) => {
      const action = chrome.tabs.sendMessage(tabId, {
        type: 'FG_ACTION',
        actionId,
      });
      await chrome.tabs.sendMessage(tabId, { type: 'FG_CANCEL' });
      return action;
    },
    { tabId, actionId: inventory.actions[0].id },
  );
  assert.equal(cancelled.value.achieved, false);
  assert.equal(cancelled.value.reason, 'ACTION_CANCELLED');
  assert.equal(await page.evaluate(() => window.safeClicks), 1);
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
  await testSourceDiagnostics({ context, page, worker, tabId, send });
  await testSourceTimeline({ context, page, worker, tabId, send });
  await testScenarioControls({ context, page, worker, tabId, send });
  await testMediaReplay({ context, page, worker, tabId, send });
  console.log(
    'DOM policy checks passed: nested open-shadow discovery and root-scoped controls, composed safety boundaries, obscured-control/link rejection, honest visible-state confirmation and bounded discovery; existing checks: safe disclosure/form/cancel boundaries, iterative menu/tab/video, actual muted playback and restore, carousel, known reject-only consent, unknown/hidden modal, lazy content and fresh-source scroll restoration, SPA navigation and sanitized action transitions.',
  );
} finally {
  await context?.close();
  await rm(directory, { recursive: true, force: true });
}
