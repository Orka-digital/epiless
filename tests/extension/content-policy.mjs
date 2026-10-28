import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testInteractivePolicy } from './content-policy-interactive.mjs';
import { testShadowPolicy } from './content-policy-shadow.mjs';
import { testMediaReplay } from './media-replay-browser.mjs';
import { testScenarioControls } from './scenario-controls.mjs';
import { testSourceDiagnostics } from './source-diagnostics.mjs';
import { testSourceTimeline } from './source-timeline.mjs';

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
  const { inspect, act } = await testInteractivePolicy({
    context,
    page,
    worker,
    tabId,
    send,
    inventory,
  });
  await testShadowPolicy({
    context,
    page,
    worker,
    tabId,
    inventory,
    inspect,
    send,
    act,
  });
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
