import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveEncodedAsset } from './native-encoded-source.mjs';
import { testReplayScenarios } from './replay-control-scenarios.mjs';
import { createReplayFixtureRunner } from './replay-fixture-runner.mjs';
import { testMediaReplayScheduling } from './replay-media-scheduling.mjs';

// These are control-flow tests, not native tabCapture permission/cadence proof.
// Only the offscreen capture boundary is replaced. Production background,
// content, IndexedDB, navigation, geometry and replay policy run unchanged.
const directory = await mkdtemp(path.join(tmpdir(), 'flashguard-replay-'));
const mediaBytes = await readFile(
  new URL('./fixtures/native-encoded/fixed.webm', import.meta.url),
);
const server = createServer((_request, response) => {
  if (_request.url === '/media.webm')
    return serveEncodedAsset(_request, response, mediaBytes);
  if (_request.url === '/media') {
    response.setHeader('content-type', 'text/html');
    response.end(
      `<!doctype html><style>button{margin:20px}video{width:2px;height:2px}</style><button type="button" aria-controls="panel" aria-expanded="false" onclick="document.documentElement.dataset.clicked=String(Date.now());this.setAttribute('aria-expanded','true');document.querySelector('#panel').hidden=false;document.querySelector('video').play()">Show details</button><div id="panel" hidden><video src="/media.webm" preload="auto" muted playsinline></video></div>`,
    );
    return;
  }
  response.setHeader('content-type', 'text/html');
  response.end(
    `<!doctype html><style>button{margin:20px}</style><button type="button" aria-controls="panel" aria-expanded="false" onclick="document.documentElement.dataset.clicked=String(Date.now());this.setAttribute('aria-expanded','true');document.querySelector('#panel').hidden=false">Show details</button><div id="panel" hidden>Static panel</div>`,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const extension = path.join(directory, 'extension');
await cp(
  fileURLToPath(new URL('../../apps/chrome-extension/dist/', import.meta.url)),
  extension,
  { recursive: true },
);
const esbuild = createRequire(
  new URL('../../apps/chrome-extension/package.json', import.meta.url),
)('esbuild');
await esbuild.build({
  entryPoints: ['background.ts', 'content.ts'].map((name) =>
    fileURLToPath(
      new URL(`../../apps/chrome-extension/src/${name}`, import.meta.url),
    ),
  ),
  outdir: extension,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  define: { __WEB_ORIGIN__: JSON.stringify('http://localhost:4321') },
});
const manifest = JSON.parse(
  await readFile(path.join(extension, 'manifest.json'), 'utf8'),
);
manifest.host_permissions = ['http://127.0.0.1/*'];
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
      viewport: null,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/dashboard.html`);
  const send = (message) =>
    control.evaluate((message) => chrome.runtime.sendMessage(message), message);
  await send({ type: 'GET_STATE' }); // Await startup recovery before installing fixture boundary.
  await worker.evaluate(() => {
    // Media evidence uses a high-resolution epoch. Integer Date.now() boundaries
    // can precede an earlier fractional-millisecond event in the same tick.
    const epochNow = () => performance.timeOrigin + performance.now();
    globalThis.__segments = [];
    globalThis.__captureTab = undefined;
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.getContexts = async () => [
      { contextType: 'OFFSCREEN_DOCUMENT' },
    ];
    chrome.tabCapture.getMediaStreamId = async ({ targetTabId }) => {
      globalThis.__captureTab = targetTabId;
      return 'explicitly-fake-capture';
    };
    chrome.runtime.sendMessage = async (message, ...args) => {
      if (message?.target !== 'offscreen') return send(message, ...args);
      if (message.type === 'SEGMENT_BEGIN') {
        globalThis.__activeSegment = {
          id: message.segmentId,
          begunAt: epochNow(),
        };
        return { ok: true, value: {} };
      }
      if (message.type === 'SEGMENT_END') {
        const record = globalThis.__activeSegment;
        const clicked = (
          await chrome.scripting.executeScript({
            target: { tabId: globalThis.__captureTab },
            func: () => Number(document.documentElement.dataset.clicked || 0),
          })
        )[0].result;
        globalThis.__segments.push({ ...record, endedAt: epochNow(), clicked });
        return {
          ok: true,
          value: {
            status: 'INCONCLUSIVE',
            passed: null,
            findings: [],
            limitations: ['EXPLICIT_FAKE_CAPTURE_CONTROL_FLOW_FIXTURE'],
            quality: {
              frameCount: 2,
              effectiveFps: 1,
              maxGapMs: 1000,
              width: 1,
              height: 1,
              downsampled: true,
              interrupted: false,
              captureWindowMs: epochNow() - record.begunAt,
              leadingIdleMs: 0,
              trailingIdleMs: 0,
            },
          },
        };
      }
      return { ok: true, value: {} };
    };
  });
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  const tab = await worker.evaluate(
    async (origin) => (await chrome.tabs.query({ url: `${origin}/*` }))[0],
    origin,
  );
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }),
    tab.id,
  );
  const inventory = (
    await worker.evaluate(
      (tabId) => chrome.tabs.sendMessage(tabId, { type: 'FG_INVENTORY' }),
      tab.id,
    )
  ).value;
  const { baseline, store, run } = await createReplayFixtureRunner({
    origin,
    inventory,
    tab,
    control,
    context,
    send,
    worker,
  });
  const trigger = {
    kind: 'control',
    target: inventory.actions[0].target,
    expectedState: 'accordion:true:true',
  };
  await testReplayScenarios({ run, baseline, trigger, worker, inventory });
  await testMediaReplayScheduling({ page, origin, worker, tab, baseline, run });
  const deletedBaseline = baseline('replay-delete-pending', [trigger]);
  await store(deletedBaseline);
  const replayOf = {
    jobId: deletedBaseline.id,
    taskId: 'route',
    observationId: 'observation',
  };
  assert.equal((await send({ type: 'PREPARE_RECHECK', replayOf })).ok, true);
  // Fixture a not-yet-authorized permission intent: granted fixture origins would
  // otherwise make PREPARE_START begin capture immediately.
  await control.evaluate(
    ({ replayOf, tabId, origin }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('flashguard-audit-v1');
        open.onsuccess = () => {
          const tx = open.result.transaction('control', 'readwrite');
          tx.objectStore('control').put(
            {
              id: 'deleted-intent',
              tabId,
              origin,
              mode: 'AUTONOMOUS',
              replayOf,
              expiresAt: Date.now() + 60000,
            },
            'start-intent',
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    { replayOf, tabId: tab.id, origin },
  );
  assert.equal(
    (await send({ type: 'DELETE', id: deletedBaseline.id })).ok,
    true,
  );
  const afterDeletion = (await send({ type: 'GET_STATE' })).value;
  assert.equal(afterDeletion.recheck, undefined);
  assert.equal(
    afterDeletion.jobs.some((job) => job.id === deletedBaseline.id),
    false,
  );
  const remainingIntent = await control.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('flashguard-audit-v1');
        open.onsuccess = () => {
          const read = open.result
            .transaction('control')
            .objectStore('control')
            .get('start-intent');
          read.onsuccess = () => resolve(read.result);
        };
      }),
  );
  assert.equal(remainingIntent, undefined);
  assert.equal((await send({ type: 'PREPARE_RECHECK', replayOf })).ok, false);
  console.log(
    'Replay control-flow fixture passed: actual background/content/IndexedDB, prepared toolbar intent, strict compact geometry gate and window restoration, trigger and real media interval inside capture segment, exact disclosure-video replay with bounded endpoint extension, retained measurement with unachieved media preconditions, rejected changed control and failed prerequisite, deleted baseline clears pending recheck/authorization. Offscreen measurements are explicitly synthetic; no native capture claim.',
  );
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
