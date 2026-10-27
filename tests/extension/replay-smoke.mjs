import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { replayScenario } from '../../apps/chrome-extension/src/scenario-plan.ts';
import { RUNNER_VERSION } from '../../apps/chrome-extension/src/model.ts';
import { ENGINE_VERSION } from '../../packages/analysis-engine/src/index.ts';
import {
  mediaPlanFromEvidence,
  mediaComparisonReasons,
  measuredMediaInterval,
} from '../../apps/chrome-extension/src/media-replay.ts';
import { replayStateKey } from '../../apps/chrome-extension/src/verification.ts';
import { serveEncodedAsset } from './native-encoded-source.mjs';

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
          begunAt: Date.now(),
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
        globalThis.__segments.push({ ...record, endedAt: Date.now(), clicked });
        return {
          ok: true,
          value: {
            status: 'INCONCLUSIVE',
            passed: null,
            findings: [],
            limitations: ['EXPLICIT_FAKE_CAPTURE_CONTROL_FLOW_FIXTURE'],
            quality: {
              frameCount: 2,
              durationMs: 1000,
              effectiveFps: 1,
              maxGapMs: 1000,
              width: 1,
              height: 1,
              downsampled: true,
              interrupted: false,
              droppedFrames: 0,
              captureWindowMs: Date.now() - record.begunAt,
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
  const baseline = (name, steps, compact = false) => {
    const recipe = replayScenario(
      `${origin}/`,
      compact
        ? { width: 600, height: 400, dpr: inventory.viewport.dpr }
        : inventory.viewport,
      steps,
      1000,
      compact ? 'compact' : 'current',
      steps.length - 1,
    );
    return {
      id: name,
      engineVersion: ENGINE_VERSION,
      runnerVersion: RUNNER_VERSION,
      tabId: tab.id,
      origin,
      startUrl: recipe.route,
      startedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:02Z',
      endedAt: '2026-01-01T00:00:02Z',
      state: 'PARTIAL',
      stopIntent: false,
      generation: name,
      elapsedMs: 1000,
      skippedLinks: 0,
      mode: 'AUTONOMOUS',
      limitations: [],
      limits: {
        maxRoutes: 1,
        maxDepth: 0,
        maxDurationMs: 20000,
        maxActionsPerRoute: 12,
      },
      tasks: [
        {
          id: 'route',
          url: recipe.route,
          depth: 0,
          state: 'PARTIAL',
          reasons: [],
          observations: [
            {
              id: 'observation',
              scenario: 'accordion',
              startedAt: '2026-01-01T00:00:00Z',
              endedAt: '2026-01-01T00:00:02Z',
              achieved: true,
              coverage: 'TESTED',
              replay: recipe,
              measurement: {
                status: 'INCONCLUSIVE',
                passed: null,
                findings: [],
                limitations: ['FAKE_BASELINE'],
                quality: {
                  frameCount: 2,
                  durationMs: 1000,
                  effectiveFps: 1,
                  maxGapMs: 1000,
                  width: 1,
                  height: 1,
                  downsampled: true,
                  interrupted: false,
                },
              },
            },
          ],
        },
      ],
    };
  };
  const store = (job) =>
    control.evaluate(
      (job) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('flashguard-audit-v1');
          open.onsuccess = () => {
            const tx = open.result.transaction('jobs', 'readwrite');
            tx.objectStore('jobs').put(job);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        }),
      job,
    );
  const run = async (job) => {
    await store(job);
    const prepared = await send({
      type: 'PREPARE_RECHECK',
      replayOf: {
        jobId: job.id,
        taskId: 'route',
        observationId: 'observation',
      },
    });
    assert.equal(prepared.ok, true, prepared.error);
    const pending = (await send({ type: 'GET_STATE' })).value.recheck;
    assert.equal(pending.replayOf.jobId, job.id);
    for (let count = 0; count < 100; count++) {
      const loaded = await worker.evaluate(
        (tabId) => chrome.tabs.get(tabId),
        pending.tabId,
      );
      if (loaded.url?.startsWith(job.origin) && loaded.status === 'complete')
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const geometry = await worker.evaluate(
      async (tabId) =>
        chrome.windows.get((await chrome.tabs.get(tabId)).windowId),
      pending.tabId,
    );
    const started = await send({
      type: 'PREPARE_START',
      tabId: pending.tabId,
      replayOf: pending.replayOf,
      mode: 'AUTONOMOUS',
    });
    assert.equal(started.ok, true, started.error);
    let result;
    for (let count = 0; count < 100; count++) {
      const state = (await send({ type: 'GET_STATE' })).value;
      result = state.jobs.find(
        (value) => value.verificationOf?.jobId === job.id,
      );
      if (result?.endedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(result?.endedAt, 'Targeted replay must reach a terminal state');
    const restored = await worker.evaluate(
      (windowId) => chrome.windows.get(windowId),
      geometry.id,
    );
    assert.equal(restored.width, geometry.width);
    assert.equal(restored.height, geometry.height);
    return result;
  };
  const trigger = {
    kind: 'control',
    target: inventory.actions[0].target,
    expectedState: 'accordion:true:true',
  };
  const positive = await run(
    baseline('replay-reached', [{ kind: 'wait', durationMs: 100 }, trigger]),
  );
  const observed = positive.tasks
    .flatMap((task) => task.observations)
    .find((value) => value.scenario === 'targeted-recheck');
  assert.ok(observed, JSON.stringify(positive));
  assert.equal(observed.achieved, true);
  assert.equal(observed.coverage, 'TESTED');
  assert.equal(observed.replay.profile, 'current');
  const segment = await worker.evaluate(
    (id) => globalThis.__segments.find((segment) => segment.id === id),
    observed.id,
  );
  assert.ok(
    segment.clicked >= segment.begunAt && segment.clicked <= segment.endedAt,
    'The actual trigger executes inside the measured segment',
  );
  const failure = await run(
    baseline('replay-stale', [
      { ...trigger, target: { ...trigger.target, kind: 'media' } },
    ]),
  );
  const rejected = failure.tasks
    .flatMap((task) => task.observations)
    .find((value) => value.scenario === 'targeted-recheck');
  assert.equal(rejected.achieved, false);
  assert.equal(rejected.coverage, 'UNREACHED');
  assert.equal(rejected.replay, undefined);
  assert.equal(rejected.reason, 'REPLAY_CONTROL_KIND_CHANGED');
  const prerequisite = await run(
    baseline('replay-prerequisite', [
      { ...trigger, target: { ...trigger.target, kind: 'media' } },
      trigger,
    ]),
  );
  assert.ok(
    prerequisite.tasks[0].observations.some(
      (value) =>
        value.scenario === 'targeted-recheck-unreached' &&
        value.coverage === 'UNREACHED',
    ),
  );
  assert.equal(
    prerequisite.tasks[0].observations.some((value) => value.replay),
    false,
  );
  const compact = await run(baseline('replay-compact', [trigger], true));
  const compactTarget = compact.tasks[0].observations.find(
    (value) => value.scenario === 'targeted-recheck',
  );
  if (compactTarget?.achieved) {
    assert.deepEqual(compactTarget.replay.viewport, {
      width: 600,
      height: 400,
      dpr: inventory.viewport.dpr,
    });
  } else {
    assert.ok(
      compact.tasks[0].observations.some(
        (value) =>
          value.coverage === 'UNREACHED' &&
          /^(VIEWPORT_GEOMETRY_NOT_REACHED|VIEWPORT_WORKSPACE_)/.test(
            value.reason,
          ),
      ),
      'Inactive tab geometry must be explicitly unobserved if Chrome does not resize its CSS viewport',
    );
    assert.equal(
      compact.tasks[0].observations.some((value) => value.replay),
      false,
    );
  }
  // Real content + background + IndexedDB media recipe. Only pixel capture is
  // fake, so this proves ordering and interval preservation, never cadence.
  await page.goto(`${origin}/media`);
  await page.bringToFront(); // Fake capture cannot keep an inactive renderer's timers alive.
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }),
    tab.id,
  );
  const mediaSend = async (message) => {
    const response = await worker.evaluate(
      ({ tabId, message }) => chrome.tabs.sendMessage(tabId, message),
      { tabId: tab.id, message },
    );
    assert.equal(response.ok, true, response.error);
    return response.value;
  };
  const mediaInventory = await mediaSend({ type: 'FG_INVENTORY' });
  const mediaTrigger = {
    kind: 'control',
    target: mediaInventory.actions[0].target,
    expectedState: 'accordion:true:true',
  };
  const mediaBase = baseline('replay-media-reached', [mediaTrigger]);
  mediaBase.startUrl = `${origin}/media`;
  mediaBase.tasks[0].url = mediaBase.startUrl;
  const mediaObservation = mediaBase.tasks[0].observations[0];
  mediaObservation.replay.route = mediaBase.startUrl;
  mediaObservation.replay.viewport = mediaInventory.viewport;
  await mediaSend({
    type: 'FG_MEDIA_OBSERVATION_START',
    generation: 'fixture',
    segmentId: 'baseline',
  });
  await mediaSend({
    type: 'FG_MEDIA_OBSERVATION_BEGIN',
    generation: 'fixture',
    segmentId: 'baseline',
  });
  await mediaSend({ type: 'FG_ACTION', target: mediaTrigger.target });
  await page.waitForTimeout(1100);
  mediaObservation.mediaEvidence = await mediaSend({
    type: 'FG_MEDIA_OBSERVATION_STOP',
    generation: 'fixture',
    segmentId: 'baseline',
  });
  mediaObservation.replay.mediaPlan = mediaPlanFromEvidence(
    mediaObservation.mediaEvidence,
  );
  assert.equal(
    mediaObservation.replay.mediaPlan.status,
    'REPLAYABLE',
    JSON.stringify(mediaObservation.mediaEvidence),
  );
  mediaObservation.replay.stateKey = replayStateKey(mediaObservation.replay);
  const mediaRepeated = await run(mediaBase);
  const mediaActual = mediaRepeated.tasks
    .flatMap((task) => task.observations)
    .find((value) => value.scenario === 'targeted-recheck');
  assert.ok(mediaActual?.achieved, JSON.stringify(mediaRepeated));
  assert.equal(
    mediaActual.mediaEvidence.complete,
    true,
    JSON.stringify(mediaActual.mediaEvidence.reasons),
  );
  assert.equal(mediaActual.replay.stateKey, mediaObservation.replay.stateKey);
  assert.deepEqual(
    mediaComparisonReasons(mediaObservation, mediaActual),
    [],
    JSON.stringify({
      baseline: mediaObservation.mediaEvidence,
      repeated: mediaActual.mediaEvidence,
    }),
  );
  assert.ok(
    measuredMediaInterval(mediaActual.mediaEvidence.items[0]).presentations >
      20,
  );
  const mediaSegment = await worker.evaluate(
    (id) => globalThis.__segments.find((segment) => segment.id === id),
    mediaActual.id,
  );
  assert.ok(mediaActual.mediaEvidence.startedEpochMs >= mediaSegment.begunAt);
  assert.ok(mediaActual.mediaEvidence.endedEpochMs <= mediaSegment.endedAt);
  const changedMedia = structuredClone(mediaBase);
  changedMedia.id = 'replay-media-mismatched';
  changedMedia.tasks[0].observations[0].replay.mediaPlan.items[0].locatorSha256 =
    'b'.repeat(64);
  changedMedia.tasks[0].observations[0].replay.stateKey = replayStateKey(
    changedMedia.tasks[0].observations[0].replay,
  );
  const failedMedia = await run(changedMedia);
  const mismatched = failedMedia.tasks
    .flatMap((task) => task.observations)
    .find((value) => value.scenario === 'targeted-recheck');
  assert.ok(
    mismatched?.measurement,
    'Failed preconditions must preserve separately measured pixel evidence',
  );
  assert.equal(mismatched.achieved, false);
  assert.equal(mismatched.coverage, 'UNREACHED');
  assert.equal(mismatched.mediaEvidence.complete, false);
  assert.ok(
    mismatched.mediaEvidence.reasons.includes(
      'MEDIA_REPLAY_PRECONDITION_UNREACHED',
    ),
  );
  assert.ok(
    mediaComparisonReasons(changedMedia.tasks[0].observations[0], mismatched)
      .length > 0,
  );
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
