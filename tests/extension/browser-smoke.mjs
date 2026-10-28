import { testStorageMigration } from './browser-storage-migration.mjs';

import { testDiagnosticExports } from './browser-diagnostic-exports.mjs';

import assert from 'node:assert/strict';

import { cp, mkdtemp, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { fileURLToPath } from 'node:url';

import path from 'node:path';

import { chromium } from '@playwright/test';
import { fixture, send, storeJob } from './browser-smoke-fixture.mjs';

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

try {
  const numericEngine = await testStorageMigration(profile);
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
  await testDiagnosticExports(page, context, profile, numericEngine);

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
  const saved = (await send(restarted, { type: 'GET_STATE' })).value.jobs.find(
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
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await rm(extension, { recursive: true, force: true });
}
