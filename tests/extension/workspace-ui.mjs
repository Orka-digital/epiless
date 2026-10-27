import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const artifacts = path.join(root, 'artifacts', 'workspace-ui');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'epiless-ui-review-'));
const extension = path.join(root, 'apps/chrome-extension/dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1440, height: 1000 },
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await expect(
    page.getByText('Je onderzoek begint op een website.'),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(artifacts, 'epiless-extension-empty.png'),
    fullPage: true,
  });
  const jobs = await Promise.all(
    [
      'scanner-v04-native-phase-media-recheck-baseline-local-job.json',
      'scanner-v04-native-phase-media-recheck-fixed-local-job.json',
    ].map(async (f) =>
      JSON.parse(
        await readFile(path.join(root, 'tests/extension/evidence', f), 'utf8'),
      ),
    ),
  );
  await page.evaluate(
    (jobs) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('flashguard-audit-v1');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('jobs', 'readwrite');
          jobs.forEach((j) => tx.objectStore('jobs').put(j));
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    jobs,
  );
  await page.goto(`chrome-extension://${id}/dashboard.html#${jobs[0].id}`);
  await page.reload();
  await expect(page.locator('#audit-title')).toBeVisible();
  await page.screenshot({
    path: path.join(artifacts, 'epiless-extension-dashboard.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: /^Bevindingen/ }).click();
  await expect(page.locator('.route-list > details').first()).toHaveAttribute(
    'open',
    '',
  );
  assert.deepEqual(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
    [],
    'Dashboard accessibility',
  );
  await page.screenshot({
    path: path.join(artifacts, 'epiless-extension-findings.png'),
    fullPage: true,
  });
  await expect(page.locator('.finding').first()).toBeVisible();
  await page.getByRole('button', { name: /^Geschiedenis/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Lokale geschiedenis' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  await expect(page.getByLabel('Meetdetails bewaren')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  await page
    .getByRole('button', { name: 'Scaninspectie', exact: true })
    .click();
  if (
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
  )
    throw new Error(
      'Dashboard mobile overflow: ' +
        JSON.stringify(
          await page.evaluate(() =>
            [...document.querySelectorAll('body *')]
              .filter(
                (el) =>
                  el.getBoundingClientRect().right >
                  document.documentElement.clientWidth + 1,
              )
              .slice(0, 12)
              .map((el) => ({
                tag: el.tagName,
                className: el.className,
                right: el.getBoundingClientRect().right,
              })),
          ),
        ),
    );
  await page.screenshot({
    path: path.join(artifacts, 'epiless-extension-mobile.png'),
    fullPage: true,
  });
  const tabId = 1;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 650 });
  // UI-only popup context fixture. No capture, authorization or source measurement is started.
  await popup.addInitScript((tabId) => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (m, ...args) => {
      const result = await send(m, ...args);
      if (m.type === 'GET_STATE' && result.ok)
        result.value.tab = {
          id: tabId,
          url: 'http://localhost:4387/voorbeeld',
        };
      if (
        m.type === 'GET_STATE' &&
        result.ok &&
        location.search.includes('recovery=1')
      ) {
        result.value.jobs[0] = {
          ...result.value.jobs[0],
          state: 'INTERRUPTED',
          tabId,
          disposableSource: undefined,
        };
      }
      return result;
    };
  }, tabId);
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(
    popup.getByRole('button', { name: 'Scan deze website' }),
  ).toBeEnabled();
  await popup.screenshot({
    path: path.join(artifacts, 'epiless-extension-popup.png'),
    fullPage: true,
  });
  assert.deepEqual(
    (
      await new AxeBuilder({ page: popup })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
    [],
    'Popup accessibility',
  );
  await popup.goto(`chrome-extension://${id}/popup.html?recovery=1`);
  await expect(
    popup.getByRole('button', { name: 'Hervat via scantab' }),
  ).toBeVisible();
  await expect(
    popup.getByRole('button', { name: 'Scan deze website' }),
  ).toHaveCount(0);
  assert.deepEqual(errors, [], 'No dashboard runtime errors');
  console.log(
    JSON.stringify({
      status: 'PASS',
      scope:
        'UI rendering and navigation only; historical jobs unchanged; no capture started',
      errors,
      profile,
    }),
  );
} finally {
  await context.close();
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
