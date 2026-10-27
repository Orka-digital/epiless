import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// This fixture invokes the production inspectSource helper in an actual DevTools
// extension page and checks Chrome's selected $0, not merely our bridge's return value.
// The page has static grey shapes only; there is no capture or flashing media.
const directory = await mkdtemp(
  path.join(tmpdir(), 'flashguard-elements-proof-'),
);
const extension = path.join(directory, 'extension');
const { mkdir } = await import('node:fs/promises');
await mkdir(extension);
const requireExtension = createRequire(
  new URL('../../apps/chrome-extension/package.json', import.meta.url),
);
const source = fileURLToPath(
  new URL('../../apps/chrome-extension/src/', import.meta.url),
);
await requireExtension('esbuild').build({
  entryPoints: [path.join(source, 'content.ts')],
  outfile: path.join(extension, 'content.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome116',
});
await requireExtension('esbuild').build({
  stdin: {
    resolveDir: source,
    contents: `
    import { inspectSource } from './inspect-source';
    let selectionChanges = 0;
    chrome.devtools.panels.elements.onSelectionChanged.addListener(() => selectionChanges++);
    chrome.runtime.sendMessage({ type: 'PROOF_READY', tabId: chrome.devtools.inspectedWindow.tabId });
    chrome.runtime.onMessage.addListener((message, _sender, reply) => {
      if (message.type !== 'PROOF_INSPECT' || message.tabId !== chrome.devtools.inspectedWindow.tabId) return;
      (async () => {
        try {
          await inspectSource(message.token, message.tabId);
          let selected = false;
          for (let tries = 0; tries < 30 && !selected; tries++) {
            await new Promise(resolve => setTimeout(resolve, 50));
            selected = await new Promise(resolve => chrome.devtools.inspectedWindow.eval(
              '$0 === globalThis.__flashguardInspectSource(' + JSON.stringify(message.token) + ') && $0?.id === "original-target"',
              { useContentScriptContext: true }, (value, exception) => resolve(!exception && value === true)));
          }
          reply({ inspected: true, selected, selectionChanges });
        } catch (error) { reply({ inspected: false, error: error.message, selectionChanges }); }
      })();
      return true;
    });
  `,
  },
  outfile: path.join(extension, 'devtools.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome116',
});
await writeFile(
  path.join(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    name: 'FlashGuard actual Elements proof',
    version: '0.0.1',
    permissions: ['scripting', 'tabs'],
    host_permissions: ['http://127.0.0.1/*'],
    devtools_page: 'devtools.html',
    background: { service_worker: 'background.js' },
  }),
);
await writeFile(
  path.join(extension, 'background.js'),
  `globalThis.readyTabs=[];chrome.runtime.onMessage.addListener(message=>{if(message.type==='PROOF_READY')globalThis.readyTabs.push(message.tabId)});`,
);
await writeFile(
  path.join(extension, 'devtools.html'),
  '<!doctype html><script src="devtools.js"></script>',
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
        '--auto-open-devtools-for-tabs',
      ],
    },
  );
  await context.route('http://127.0.0.1:47821/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#ddd}#original-target{position:fixed;left:10px;top:10px;width:100px;height:100px;background:#aaa}</style><div id="original-target"></div><section></section>',
    }),
  );
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:47821/inspect');
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const tabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ url: 'http://127.0.0.1:47821/*' }))[0].id,
  );
  for (
    let tries = 0;
    tries < 60 &&
    !(await worker.evaluate(
      (tabId) => globalThis.readyTabs.includes(tabId),
      tabId,
    ));
    tries++
  )
    await page.waitForTimeout(100);
  assert.ok(
    await worker.evaluate(
      (tabId) => globalThis.readyTabs.includes(tabId),
      tabId,
    ),
    'Actual DevTools extension page loaded',
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
  await send({
    type: 'FG_SOURCE_TIMELINE_START',
    generation: 'inspect-proof',
    segmentId: 'inspect-proof',
  });
  const start = await page.evaluate(
    () => performance.timeOrigin + performance.now(),
  );
  await page.waitForTimeout(180);
  // A small style mutation makes this exact node a sampled target without visual change.
  await page.evaluate(
    () => (document.querySelector('#original-target').style.opacity = '1'),
  );
  await page.waitForTimeout(180);
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    epoch: performance.timeOrigin + performance.now(),
  }));
  await send({
    type: 'FG_SOURCE_TIMELINE_EVENT',
    event: {
      generation: 'inspect-proof',
      segmentId: 'inspect-proof',
      findingId: 'inspect-proof',
      windowStartMs: 0,
      windowEndMs: geometry.epoch - start,
      windowStartEpochMs: start,
      windowEndEpochMs: geometry.epoch,
      clockBasis: 'FRAME_RECEIPT_ESTIMATE',
      alignmentUncertaintyMs: null,
      analysis: { width: geometry.width, height: geometry.height },
      source: { width: geometry.width, height: geometry.height },
      region: { x: 10, y: 10, width: 100, height: 100 },
    },
  });
  const timeline = (
    await send({
      type: 'FG_SOURCE_TIMELINE_STOP',
      generation: 'inspect-proof',
      segmentId: 'inspect-proof',
    })
  ).value['inspect-proof'];
  const candidate = timeline.candidates.find(
    (candidate) => candidate.tag === 'div',
  );
  assert.ok(
    candidate?.inspectionToken,
    'Original div received an isolated capability',
  );
  // Spoofing the page world cannot redirect the isolated-world production inspector.
  await page.evaluate(() => {
    globalThis.__flashguardInspectSource = () => document.body;
  });
  const inspect = () =>
    worker.evaluate(
      ({ tabId, token }) =>
        chrome.runtime.sendMessage({ type: 'PROOF_INSPECT', tabId, token }),
      { tabId, token: candidate.inspectionToken },
    );
  const first = await inspect();
  assert.equal(first.inspected, true, JSON.stringify(first));
  assert.equal(
    first.selected,
    true,
    'Actual Chrome Elements $0 must be the original capability node',
  );
  assert.ok(
    first.selectionChanges > 0,
    'Chrome Elements emitted a real selection change',
  );
  await page.evaluate(() =>
    document
      .querySelector('section')
      .append(document.querySelector('#original-target')),
  );
  assert.equal(
    (await inspect()).selected,
    true,
    'Moving the original Element preserves identity',
  );
  await page.evaluate(() => {
    const node = document.querySelector('#original-target');
    node.replaceWith(node.cloneNode(true));
  });
  assert.equal(
    (await inspect()).inspected,
    false,
    'A replacement at the same path cannot reuse the capability',
  );
  console.log(
    JSON.stringify({
      test: 'actual-devtools-elements-inspection',
      browser: context.browser()?.version(),
      selectedOriginal: true,
      movedOriginal: true,
      replacedOriginalRejected: true,
      pageSpoofIgnored: true,
      selectionChanges: first.selectionChanges,
    }),
  );
} finally {
  await context?.close();
  await rm(directory, { recursive: true, force: true });
}
