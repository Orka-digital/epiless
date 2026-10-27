import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const configuredWeb = new URL(
  process.env.EPI_LESS_WEB_URL ?? 'http://localhost:4321',
);
if (
  !['http:', 'https:'].includes(configuredWeb.protocol) ||
  !['localhost', '127.0.0.1'].includes(configuredWeb.hostname) ||
  configuredWeb.pathname !== '/' ||
  configuredWeb.search ||
  configuredWeb.hash ||
  configuredWeb.username ||
  configuredWeb.password
) {
  throw new Error(
    'Extension browser tests require a loopback EPI_LESS_WEB_URL origin (localhost or 127.0.0.1), without credentials, path, query or fragment.',
  );
}
const webOrigin = configuredWeb.origin;
const builtExtension = fileURLToPath(
  new URL('../../apps/chrome-extension/dist/', import.meta.url),
);
const profile = await mkdtemp(
  path.join(tmpdir(), 'flashguard-extension-test-'),
);
const extension = await mkdtemp(
  path.join(tmpdir(), 'flashguard-extension-build-'),
);
await cp(builtExtension, extension, { recursive: true });
let context;
let migrationBrowser;
const launch = () =>
  chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
const getId = async () =>
  new URL(
    (
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'))
    ).url(),
  ).host;
const send = (page, message) =>
  page.evaluate((value) => chrome.runtime.sendMessage(value), message);
async function storeJob(page, job, active) {
  await page.evaluate(
    ({ job, active }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('flashguard-audit-v1');
        request.onsuccess = () => {
          const tx = request.result.transaction(
            ['jobs', 'control'],
            'readwrite',
          );
          tx.objectStore('jobs').put(job);
          if (active) tx.objectStore('control').put(job.id, 'active');
          tx.oncomplete = () => resolve(undefined);
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    { job, active },
  );
}
function fixture(id, state) {
  return {
    id,
    tabId: 9999,
    origin: 'https://example.test',
    startUrl: 'https://example.test/',
    startedAt: '2026-10-26T12:00:00Z',
    updatedAt: '2026-10-26T12:00:00Z',
    state,
    stopIntent: state === 'PAUSED',
    generation: id + '-lease',
    elapsedMs: 0,
    mode: 'AUTONOMOUS',
    skippedLinks: 0,
    limitations: [],
    limits: {
      maxRoutes: 50,
      maxDepth: 4,
      maxDurationMs: 1200000,
      maxActionsPerRoute: 12,
    },
    tasks: [
      {
        id: 'home',
        url: 'https://example.test/',
        depth: 0,
        state: 'QUEUED',
        observations: [],
        reasons: [],
      },
    ],
  };
}
try {
  // Exercise the real store module against Chromium IndexedDB, starting from v1.
  // A standalone fixture avoids Chrome's cached service-worker update behavior.
  const requireExtension = createRequire(
    new URL('../../apps/chrome-extension/package.json', import.meta.url),
  );
  const { build } = requireExtension('esbuild');
  const storageScript = path.join(profile, 'storage-fixture.js');
  await build({
    entryPoints: [
      fileURLToPath(
        new URL('../../apps/chrome-extension/src/store.ts', import.meta.url),
      ),
    ],
    bundle: true,
    format: 'iife',
    globalName: 'FlashGuardStorage',
    outfile: storageScript,
  });
  // Execute the production engine on numeric arrays in Chromium. No pixel is
  // painted to a page; this validates diagnostic data flow, not tab capture.
  const analysisScript = path.join(profile, 'analysis-fixture.js');
  await build({
    entryPoints: [
      fileURLToPath(
        new URL('../../packages/analysis-engine/src/index.ts', import.meta.url),
      ),
    ],
    bundle: true,
    format: 'iife',
    globalName: 'FlashGuardAnalysis',
    outfile: analysisScript,
  });
  const storageHtml = path.join(profile, 'storage-fixture.html');
  await writeFile(
    storageHtml,
    '<!doctype html><title>IndexedDB migration fixture</title>',
  );
  migrationBrowser = await chromium.launch({
    channel: 'chromium',
    headless: true,
  });
  const migrationPage = await migrationBrowser.newPage();
  await migrationPage.goto(`file://${storageHtml}`);
  await migrationPage.evaluate(
    (job) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('flashguard-audit-v1', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('jobs', { keyPath: 'id' });
          request.result.createObjectStore('control');
          request.result.createObjectStore('transfers', { keyPath: 'nonce' });
        };
        request.onsuccess = () => {
          const tx = request.result.transaction('jobs', 'readwrite');
          tx.objectStore('jobs').put(job);
          tx.oncomplete = () => {
            request.result.close();
            resolve(undefined);
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    fixture('migration-preserved', 'COMPLETED'),
  );
  await migrationPage.addScriptTag({ path: storageScript });
  assert.equal(
    (
      await migrationPage.evaluate(() =>
        FlashGuardStorage.getJob('migration-preserved'),
      )
    ).id,
    'migration-preserved',
  );
  assert.equal(
    await migrationPage.evaluate(
      async () =>
        (await indexedDB.databases()).find(
          (database) => database.name === 'flashguard-audit-v1',
        ).version,
    ),
    2,
  );
  await migrationPage.addScriptTag({ path: analysisScript });
  const numericEngine = await migrationPage.evaluate(() => {
    const analyzer = new FlashGuardAnalysis.FrameAnalyzer();
    for (let time = 0; time <= 1200; time += 20) {
      const value = Math.floor(time / 100) % 2 ? 255 : 0;
      analyzer.pushFrame({
        rgba: new Uint8Array([value, value, value, 255]),
        width: 1,
        height: 1,
        timestampMs: 100_000 + time,
      });
    }
    return {
      engineVersion: FlashGuardAnalysis.ENGINE_VERSION,
      measurement: analyzer.finish(),
    };
  });
  assert.equal(numericEngine.measurement.passed, null);
  assert.equal(numericEngine.measurement.findings.length, 1);
  assert.equal(numericEngine.measurement.findings[0].qualifyingTransitions, 7);
  assert.equal(numericEngine.measurement.findings[0].diagnostic.complete, true);
  assert.ok(
    numericEngine.measurement.findings[0].diagnostic.samples.length > 7,
  );
  await migrationBrowser.close();
  migrationBrowser = undefined;
  context = await launch();
  const id = await getId();
  await context.route(
    (url) => url.origin === webOrigin,
    (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Safe publication bridge fixture</title><h1>Static fixture</h1>',
      }),
  );
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.getByRole('heading', { name: 'Scaninspectie' }).waitFor();
  const initialState = await send(page, { type: 'GET_STATE' });
  assert.equal(initialState.ok, true);
  assert.equal(
    initialState.value.webOrigin,
    webOrigin,
    'Build the extension using the same EPI_LESS_WEB_URL as the browser test.',
  );
  const diagnosticJob = fixture('paused-report', 'PAUSED');
  diagnosticJob.engineVersion = numericEngine.engineVersion;
  diagnosticJob.runnerVersion = 'numeric-browser-fixture';
  diagnosticJob.limitations = [
    'Numeric engine fixture only; no browser capture or screen content was measured.',
  ];
  diagnosticJob.tasks[0].state = 'OBSERVED';
  diagnosticJob.tasks[0].observations = [
    {
      id: 'numeric-engine-diagnostic',
      scenario: 'NUMERIC_ENGINE_DIAGNOSTIC_FIXTURE',
      startedAt: '2026-10-26T12:00:00Z',
      endedAt: '2026-10-26T12:00:01.200Z',
      achieved: true,
      measurement: numericEngine.measurement,
    },
  ];
  await storeJob(page, diagnosticJob, true);
  await page.reload();
  await page.getByRole('button', { name: 'Stop scan' }).click();
  await page.getByRole('button', { name: 'Exporteer JSON' }).waitFor();
  let saved = (await send(page, { type: 'GET_STATE' })).value.jobs.find(
    (job) => job.id === 'paused-report',
  );
  assert.equal(saved.state, 'PARTIAL');
  assert.equal(saved.stopIntent, true);
  assert.equal(saved.stopReason, 'USER_STOP');
  assert.deepEqual(
    saved.tasks[0].observations[0].measurement.findings,
    numericEngine.measurement.findings,
    'IndexedDB preserves the actual numeric-engine evidence',
  );
  await page.locator('.route-list > details > summary').click();
  await page.locator('.finding-diagnostics > summary').click();
  await page.getByRole('img', { name: /^Statisch meetspoor:/ }).waitFor();
  await page.getByText('Ruwe pixelsamples bekijken', { exact: true }).click();
  const localSamples = page.getByRole('table', {
    name: 'Analysepixel: tijd in ms en sRGB-kanalen van 0 tot 255',
  });
  assert.equal(
    await localSamples.locator('tbody tr').count(),
    numericEngine.measurement.findings[0].diagnostic.samples.length,
  );
  assert.match(
    await page.locator('.finding-diagnostics').innerText(),
    /Minstens 7 kwalificerende overgangen/,
  );
  assert.match(await localSamples.locator('tbody').innerText(), /255/);
  assert.equal(
    await page
      .locator(
        '.finding-diagnostics img, .finding-diagnostics video, .finding-diagnostics canvas, .finding-diagnostics animate',
      )
      .count(),
    0,
    'Diagnostics must remain static numeric markup',
  );

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporteer JSON' }).click();
  const artifact = await download;
  const report = JSON.parse(await readFile(await artifact.path(), 'utf8'));
  assert.equal(report.status, 'INCONCLUSIVE');
  assert.equal(report.passed, null);
  assert.equal(report.engineVersion, numericEngine.engineVersion);
  assert.deepEqual(
    report.routes[0].scenarios[0].findings,
    numericEngine.measurement.findings,
    'Report contract and JSON export preserve numeric diagnostic evidence',
  );
  const htmlDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporteer HTML' }).click();
  const htmlArtifact = await htmlDownload;
  const html = await readFile(await htmlArtifact.path(), 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Geen gevalideerd WCAG-oordeel'));
  assert.ok(!html.includes('<script'));
  const exportPage = await context.newPage();
  const htmlPath = path.join(profile, 'offline-report.html');
  await writeFile(htmlPath, html);
  await exportPage.goto(`file://${htmlPath}`);
  await exportPage.getByRole('heading', { name: 'Meetresultaten' }).waitFor();
  await exportPage.locator('.finding-diagnostics > summary').click();
  await exportPage.getByRole('img', { name: /^Statisch meetspoor:/ }).waitFor();
  await exportPage
    .getByText('Ruwe pixelsamples bekijken', { exact: true })
    .click();
  const exportedSamples = exportPage.getByRole('table', {
    name: 'Analysepixel: tijd in ms en sRGB-kanalen van 0 tot 255',
  });
  assert.equal(
    await exportedSamples.locator('tbody tr').count(),
    numericEngine.measurement.findings[0].diagnostic.samples.length,
  );
  assert.equal(
    await exportedSamples.locator('tbody').innerText(),
    await localSamples.locator('tbody').innerText(),
    'Offline HTML retains the exact same displayed RGB sample table',
  );
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const accessibility = await new AxeBuilder({ page: exportPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  assert.deepEqual(
    accessibility.violations,
    [],
    'Standalone HTML must be accessible',
  );
  await exportPage.close();
  assert.equal(
    (
      await send(page, {
        type: 'SET_HISTORY_SETTINGS',
        settings: { detailRetentionDays: -1 },
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await send(page, {
        type: 'SET_HISTORY_SETTINGS',
        settings: { detailRetentionDays: null },
      })
    ).ok,
    true,
  );
  assert.equal(
    (await send(page, { type: 'GET_STATE' })).value.settings
      .detailRetentionDays,
    null,
  );
  const history = (await send(page, { type: 'EXPORT_HISTORY' })).value;
  assert.equal(history.kind, 'FLASHGUARD_LOCAL_HISTORY');
  assert.equal(history.audits.length, 1);
  assert.deepEqual(
    history.audits[0].report.routes[0].scenarios[0].findings,
    numericEngine.measurement.findings,
  );
  const pseudonymized = (
    await send(page, { type: 'EXPORT_HISTORY', pseudonymize: true })
  ).value;
  assert.equal(
    pseudonymized.audits[0].report.routes[0].scenarios[0].findings[0]
      .diagnostic,
    undefined,
    'Pseudonymized exports remove optional pixel diagnostics',
  );

  const newTab = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Uploadvoorbeeld openen' }).click();
  const publish = await newTab;
  await publish.waitForURL(
    (url) =>
      url.origin === webOrigin &&
      url.pathname === '/publish' &&
      url.hash.startsWith('#extension='),
  );
  const fragment = new URLSearchParams(new URL(publish.url()).hash.slice(1));
  const nonce = fragment.get('nonce');
  assert.equal(fragment.get('extension'), id);
  assert.ok(nonce);
  const external = (tab, nonce) =>
    tab.evaluate(
      ({ id, nonce }) =>
        chrome.runtime.sendMessage(id, { type: 'FLASHGUARD_IMPORT', nonce }),
      { id, nonce },
    );
  const wrongTab = await context.newPage();
  await wrongTab.goto(`${webOrigin}/publish`);
  assert.equal(
    (await external(wrongTab, nonce)).ok,
    false,
    'A different tab must not steal a transfer',
  );
  const changedAfterPreview = fixture('paused-report', 'INTERRUPTED');
  changedAfterPreview.stopReason = 'CHANGED_AFTER_PREVIEW';
  await storeJob(page, changedAfterPreview, false);
  const result = await external(publish, nonce);
  assert.equal(result.ok, true);
  assert.equal(result.report.id, 'paused-report');
  assert.deepEqual(
    result.report.routes[0].scenarios[0].findings,
    numericEngine.measurement.findings,
    'Tab-bound local publication transfer preserves the frozen diagnostic snapshot for user review',
  );
  assert.equal(
    result.report.job.stopReason,
    'USER_STOP',
    'The transfer must contain the exact snapshot selected before later job changes',
  );
  assert.equal(
    (await external(publish, nonce)).ok,
    false,
    'Transfer nonces must be single-use',
  );
  await page.reload();
  assert.equal((await send(page, { type: 'GET_STATE' })).value.jobs.length, 1);

  await storeJob(page, fixture('browser-restart', 'RUNNING'), true);
  assert.equal(
    (await send(page, { type: 'DELETE_HISTORY' })).ok,
    false,
    'Active jobs block destructive bulk deletion',
  );
  await context.close();
  context = await launch();
  const restartedId = await getId();
  const restarted = await context.newPage();
  await restarted.goto(`chrome-extension://${restartedId}/dashboard.html`);
  saved = (await send(restarted, { type: 'GET_STATE' })).value.jobs.find(
    (job) => job.id === 'browser-restart',
  );
  assert.equal(saved.state, 'INTERRUPTED');
  assert.equal(saved.stopIntent, true);
  assert.equal(saved.stopReason, 'BROWSER_OR_WORKER_RESTART');
  assert.equal(
    (await send(restarted, { type: 'GET_STATE' })).value.settings
      .detailRetentionDays,
    null,
    'Retention preference survives restart',
  );
  const other = fixture('other-site', 'COMPLETED');
  other.origin = 'https://second.test';
  other.startUrl = 'https://second.test/';
  other.tasks[0].url = other.startUrl;
  await storeJob(restarted, other, false);
  assert.equal(
    (
      await send(restarted, {
        type: 'EXPORT_HISTORY',
        origin: 'https://second.test',
      })
    ).value.audits.length,
    1,
  );
  await restarted.getByRole('button', { name: /^Geschiedenis/ }).click();
  const sitePicker = restarted.getByLabel('Website', { exact: true });
  await sitePicker.selectOption('https://example.test');
  await restarted
    .getByRole('button', { name: 'Wis website', exact: true })
    .click();
  await restarted
    .getByRole('button', { name: 'Bevestig verwijderen', exact: true })
    .click();
  await restarted.waitForFunction(
    () => document.querySelector('select')?.value === '',
  );
  assert.equal(
    await sitePicker.inputValue(),
    '',
    'Deleting the selected website resets the filter to all websites',
  );
  await restarted
    .locator('.history')
    .getByRole('button', { name: /^second\.test/ })
    .waitFor();
  assert.deepEqual(
    (await send(restarted, { type: 'GET_STATE' })).value.jobs.map(
      (job) => job.id,
    ),
    ['other-site'],
  );
  assert.equal((await send(restarted, { type: 'DELETE_HISTORY' })).ok, true);
  const cleared = (await send(restarted, { type: 'GET_STATE' })).value;
  assert.equal(cleared.jobs.length, 0);
  assert.equal(cleared.settings.detailRetentionDays, 90);
  console.log(
    'Extension browser checks passed: v1→v2 migration without history loss, React dashboard, numeric engine→report→IndexedDB→static diagnostic UI and exact sample exports, durable stop, JSON/HTML exports, offline HTML accessibility, site/all index export and deletion guards, retention preferences, tab-bound single-use transfer, browser-restart recovery.',
  );
  console.log(
    'Capture quality and real toolbar capture across navigation remain separate release gates; this test does not validate them.',
  );
} finally {
  await migrationBrowser?.close();
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await rm(extension, { recursive: true, force: true });
}
