// Real dashboard rendering of byte-exact historical native captures.
// This is UI evidence only; it neither starts a capture nor invents a recheck.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const files = [
  'scanner-v04-native-current-encoded-local-job.json',
  'scanner-v04-native-media-recheck-fixed-local-job.json',
];
const originals = await Promise.all(
  files.map(async (name) => {
    const bytes = await readFile(
      new URL(`./evidence/${name}`, import.meta.url),
    );
    return {
      name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      job: JSON.parse(bytes),
    };
  }),
);
const [unrepeatable, repeatable] = originals.map((entry) => entry.job);
assert.ok(
  unrepeatable.tasks.some((task) =>
    task.observations.some((observation) =>
      observation.replay?.mediaPlan?.reasons.includes(
        'MEDIA_SEEK_DURING_OBSERVATION',
      ),
    ),
  ),
);
assert.ok(
  repeatable.tasks.some((task) =>
    task.observations.some(
      (observation) =>
        observation.replay?.mediaPlan?.status === 'REPLAYABLE' &&
        observation.mediaEvidence?.items.length > 0,
    ),
  ),
);
const directory = await mkdtemp(
  path.join(tmpdir(), 'flashguard-replay-evidence-ui-'),
);
const extension = fileURLToPath(
  new URL('../../apps/chrome-extension/dist/', import.meta.url),
);
const extensionFiles = {};
for (const name of (await readdir(extension)).sort())
  extensionFiles[name] = createHash('sha256')
    .update(await readFile(path.join(extension, name)))
    .digest('hex');
let context;
try {
  context = await chromium.launchPersistentContext(
    path.join(directory, 'profile'),
    {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1000, height: 850 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const dashboard = `chrome-extension://${extensionId}/dashboard.html`;
  await page.goto(dashboard);
  assert.equal(
    (
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_STATE' }),
      )
    ).ok,
    true,
  );
  await page.evaluate(
    (jobs) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('flashguard-audit-v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('jobs', 'readwrite');
          for (const job of jobs) tx.objectStore('jobs').put(job);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        };
      }),
    originals.map((entry) => entry.job),
  );
  await page.goto(`${dashboard}#${unrepeatable.id}`);
  await page.reload();
  const blocked = page
    .locator('.replay-evidence')
    .filter({ hasText: 'Tijdens de meting versprong de afspeelpositie.' })
    .first();
  await blocked
    .locator(
      'xpath=ancestor::details[contains(@class,"route-list") or parent::*[contains(@class,"route-list")]]',
    )
    .locator(':scope > summary')
    .click();
  await blocked.locator(':scope > summary').click();
  await expect(
    blocked.getByText('Tijdens de meting versprong de afspeelpositie.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    blocked.getByText(/bewijst het uitblijven van een melding geen herstel/),
  ).toBeVisible();
  const rawCodes = blocked.locator('details p');
  await expect(rawCodes).toBeHidden();
  await blocked.getByText('Technische meetcodes', { exact: true }).click();
  await expect(rawCodes).toContainText('MEDIA_SEEK_DURING_OBSERVATION');
  await expect(blocked.getByText(/eerste tijdcode/).first()).toBeVisible();
  await page.goto(`${dashboard}#${repeatable.id}`);
  await page.reload();
  const ready = page
    .locator('.replay-evidence')
    .filter({ hasText: 'Videotijdcodes voor hercontrole beschikbaar' })
    .first();
  await ready
    .locator(
      'xpath=ancestor::details[parent::*[contains(@class,"route-list")]]',
    )
    .locator(':scope > summary')
    .click();
  await ready.locator(':scope > summary').click();
  await expect(ready.getByText(/daadwerkelijk opnieuw bereiken/)).toBeVisible();
  await expect(ready.getByText(/53 videopresentaties/)).toBeVisible();
  const legacyPhase = ready.locator('..').locator('.phase-evidence');
  await legacyPhase.locator(':scope > summary').click();
  await expect(
    legacyPhase.getByText(/Het oorspronkelijke tijdstip/),
  ).toBeVisible();
  await expect(
    legacyPhase.getByText(/niet worden gebruikt om het probleem als opgelost/),
  ).toBeVisible();
  await expect(
    ready.getByText(/geen geanalyseerde schermbeelden/),
  ).toBeVisible();
  await expect(
    ready.getByText('Technische meetcodes', { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(directory, 'replay-evidence.png'),
    fullPage: true,
  });
  const result = {
    scope:
      'Current dashboard over preserved native evidence; no new capture or comparison lifecycle.',
    passed: true,
    extensionFiles,
    sources: originals.map(({ name, sha256 }) => ({ name, sha256 })),
    artifactDirectory: directory,
  };
  await writeFile(
    path.join(directory, 'result.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context?.close();
  await rm(path.join(directory, 'profile'), { recursive: true, force: true });
}
