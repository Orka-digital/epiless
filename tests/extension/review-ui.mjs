// Real dashboard clicks over retained native capture evidence. These are two
// separate historical-state UI tests, NOT a newly captured end-to-end lifecycle.
// No capture timestamps, scanner hashes, runtime APIs or browser clocks are mocked.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const evidence = await mkdtemp(path.join(tmpdir(), 'flashguard-review-ui-'));
const extension = path.join(evidence, 'extension');
const profile = path.join(evidence, 'profile');
const sourceDirectory = new URL('./evidence/', import.meta.url);
const names = [
  'scanner-v04-native-detail-local-job.json',
  'scanner-v04-native-fixed-local-job.json',
  'scanner-v04-native-recurrence-local-job.json',
  'scanner-v04-native-review-verification.json',
];
const sourceFiles = await Promise.all(
  names.map(async (name) => {
    const bytes = await readFile(new URL(name, sourceDirectory));
    return {
      name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      value: JSON.parse(bytes),
    };
  }),
);
const [baseline, fixed, recurrence, originalReviews] = sourceFiles.map(
  (entry) => entry.value,
);
assert.equal(baseline.reviews?.length ?? 0, 0);
assert.equal(originalReviews.jobId, baseline.id);
assert.equal(originalReviews.scannerBuildSha256, baseline.scannerBuildSha256);
assert.equal(fixed.scannerBuildSha256, baseline.scannerBuildSha256);
assert.equal(recurrence.scannerBuildSha256, baseline.scannerBuildSha256);
const prefix = originalReviews.reviews.slice(0, 2);
assert.deepEqual(
  prefix.map((entry) => entry.decision),
  ['CONFIRMED', 'RESOLVED'],
);
assert.equal(prefix[1].verificationJobId, fixed.id);
assert.ok(Date.parse(recurrence.startedAt) > Date.parse(prefix[1].at));
const anchor = {
  taskId: prefix[0].taskId,
  observationId: prefix[0].observationId,
  findingId: prefix[0].findingId,
};
assert.ok(
  prefix.every((entry) =>
    Object.entries(anchor).every(([key, value]) => entry[key] === value),
  ),
);
const sourceObservation = baseline.tasks
  .find((task) => task.id === anchor.taskId)
  ?.observations.find((observation) => observation.id === anchor.observationId);
assert.ok(
  sourceObservation?.measurement.findings.some(
    (finding) => finding.id === anchor.findingId,
  ),
);

await cp(
  fileURLToPath(new URL('../../apps/chrome-extension/dist/', import.meta.url)),
  extension,
  { recursive: true },
);
async function extensionHashes() {
  const hashes = {};
  for (const name of (await readdir(extension)).sort()) {
    hashes[name] = createHash('sha256')
      .update(await readFile(path.join(extension, name)))
      .digest('hex');
  }
  return hashes;
}
const buildHashes = await extensionHashes();
const actions = [];
let context;
let traceStarted = false;
let completed = false;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: process.env.EPI_LESS_REVIEW_UI_HEADED !== '1',
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  traceStarted = true;
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const dashboard = await context.newPage();
  const dashboardUrl = `chrome-extension://${extensionId}/dashboard.html#${baseline.id}`;
  await dashboard.goto(dashboardUrl);
  const state = async () => {
    const response = await dashboard.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'GET_STATE' }),
    );
    assert.equal(response.ok, true, response.error);
    return response.value;
  };
  await state(); // Await genuine startup/IndexedDB initialization before setup.
  const importJobs = (jobs) =>
    dashboard.evaluate(
      (values) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('flashguard-audit-v1');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('jobs', 'readwrite');
            for (const job of values) tx.objectStore('jobs').put(job);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error);
            };
          };
        }),
      jobs,
    );
  const openPanel = async () => {
    await dashboard.reload();
    const observation = dashboard.locator(
      `[data-observation-id="${sourceObservation.id}"]`,
    );
    await expect(observation).toHaveCount(1);
    // The production route and review disclosures are opened by real clicks.
    const route = dashboard
      .locator('.route-list > details')
      .filter({ has: observation });
    await route.locator(':scope > summary').click();
    const panel = observation.locator('.verification-panel');
    await expect(panel).toHaveCount(1);
    await panel.locator(':scope > summary').click();
    return panel;
  };
  const clickReview = async (panel, phase, label) => {
    const button = panel.getByRole('button', { name: label, exact: true });
    await expect(button).toBeEnabled();
    actions.push({
      phase,
      action: 'REAL_DASHBOARD_BUTTON_CLICK',
      label,
      at: new Date().toISOString(),
    });
    await button.click();
  };
  const baselineState = async () => {
    const job = (await state()).jobs.find((entry) => entry.id === baseline.id);
    assert.ok(job);
    return job;
  };
  const capturePayload = (job) => {
    const { reviews: _reviews, updatedAt: _updatedAt, ...unchanged } = job;
    return unchanged;
  };

  // Current comparator migration: historical native captures have no phase
  // evidence. Their original resolution proof remains retained unchanged; this
  // current build must refuse a NEW resolution from those old negative jobs.
  await importJobs([baseline, fixed, recurrence]);
  let panel = await openPanel();
  await panel.getByLabel('Vergelijk met hercontrole').selectOption(fixed.id);
  await expect(
    panel.getByText('Hercontrole nog niet vergelijkbaar', { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(
      'Het oorspronkelijke tijdstip binnen de pagina- en animatiecyclus is niet vastgelegd.',
      { exact: true },
    ),
  ).toBeVisible();
  await panel
    .getByLabel('Toelichting bij jouw beoordeling')
    .fill(
      'Huidige UI: oorspronkelijke kandidaat bevestigd; oude negatieve meting mist fasebewijs.',
    );
  await clickReview(panel, 'A', 'Probleem bevestigen');
  await expect(panel.locator(':scope > summary')).toContainText(
    'Probleem bevestigd',
  );
  await expect(
    panel.getByRole('button', { name: 'Als opgelost beoordelen', exact: true }),
  ).toBeDisabled();
  const phaseA = await baselineState();
  assert.deepEqual(
    phaseA.reviews.map((entry) => entry.decision),
    ['CONFIRMED'],
  );
  assert.deepEqual(capturePayload(phaseA), capturePayload(baseline));
  const rejected = await dashboard.evaluate(
    ({ jobId, anchor, verificationJobId }) =>
      chrome.runtime.sendMessage({
        type: 'REVIEW_ISSUE',
        jobId,
        review: {
          ...anchor,
          decision: 'RESOLVED',
          note: 'Legacy negative must remain incomparable.',
          verificationJobId,
        },
      }),
    { jobId: baseline.id, anchor, verificationJobId: fixed.id },
  );
  assert.equal(
    rejected.ok,
    false,
    'Runtime must also reject unsupported legacy resolution',
  );
  assert.match(rejected.error, /vergelijkbaar|waargenomen|hercontrole/i);
  await panel.screenshot({
    path: path.join(evidence, 'phase-a-legacy-negative-refused.png'),
  });
  panel = await openPanel();
  await expect(panel.locator(':scope > summary')).toContainText(
    'Probleem bevestigd',
  );

  // Historical review events are not rewritten or erased by this migration.
  await importJobs([{ ...baseline, reviews: structuredClone(prefix) }]);
  panel = await openPanel();
  await expect(panel.locator(':scope > summary')).toContainText(
    'Opgelost na hercontrole',
  );
  await panel
    .getByLabel('Vergelijk met hercontrole')
    .selectOption(recurrence.id);
  await expect(
    panel.getByText('Hercontrole nog niet vergelijkbaar', { exact: true }),
  ).toBeVisible();
  await panel
    .getByLabel('Toelichting bij jouw beoordeling')
    .fill('Geen nieuwe tijdsvergelijking zonder fasebewijs.');
  await expect(
    panel.getByRole('button', { name: 'Terugkeer bevestigen', exact: true }),
  ).toBeDisabled();
  const phaseB = await baselineState();
  assert.deepEqual(phaseB.reviews, prefix);
  assert.deepEqual(capturePayload(phaseB), capturePayload(baseline));
  await panel.screenshot({
    path: path.join(evidence, 'phase-b-historical-reviews-preserved.png'),
  });
  const finalState = await state();
  assert.equal(finalState.jobs.length, 3, 'No new capture job was created');
  for (const original of [fixed, recurrence])
    assert.deepEqual(
      finalState.jobs.find((job) => job.id === original.id),
      original,
    );
  const capturedTabs = await worker.evaluate(() =>
    chrome.tabCapture.getCapturedTabs(),
  );
  assert.deepEqual(capturedTabs, [], 'No tabCapture producer was opened');
  assert.deepEqual(
    await extensionHashes(),
    buildHashes,
    'Production bundle was not instrumented',
  );
  for (const source of sourceFiles) {
    const bytes = await readFile(new URL(source.name, sourceDirectory));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      source.sha256,
    );
  }
  const result = {
    scope:
      'Current real dashboard migration test over unchanged retained native captures: a candidate can still be confirmed, but missing document/animation phase evidence refuses a new resolution in both UI and runtime. Historical review events remain intact; old recurrence cannot establish a new comparable transition. No capture or synthetic timestamp/hash mutation.',
    result: 'PASS',
    recordedAt: new Date().toISOString(),
    browser: context.browser().version(),
    headless: process.env.EPI_LESS_REVIEW_UI_HEADED !== '1',
    nativeEvidenceScannerBuildSha256: baseline.scannerBuildSha256,
    testedExtensionFilesSha256: buildHashes,
    sourceFiles: sourceFiles.map(({ value: _value, ...identity }) => identity),
    anchor,
    actions,
    phaseA: {
      reviews: phaseA.reviews,
      legacyNegativeResolutionRefused: true,
      runtimeRefusal: rejected,
    },
    phaseB: {
      originalReviewPrefix: prefix,
      reviews: phaseB.reviews,
      historicalReviewEventsPreserved: true,
      legacyRecurrenceReopenDisabled: true,
    },
    originalCapturePayloadsUnchanged: true,
    newCaptureJobs: 0,
    activeCapturedTabs: 0,
    screenshots: [
      'phase-a-legacy-negative-refused.png',
      'phase-b-historical-reviews-preserved.png',
    ],
    trace: 'review-ui-trace.zip',
  };
  await writeFile(
    path.join(evidence, 'review-ui-verification.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  completed = true;
  console.log(
    JSON.stringify({ result: 'PASS', evidence, scope: result.scope }),
  );
} finally {
  if (traceStarted)
    await context.tracing.stop({
      path: path.join(evidence, 'review-ui-trace.zip'),
    });
  await context?.close();
  await Promise.all([
    rm(profile, { recursive: true, force: true }),
    rm(extension, { recursive: true, force: true }),
  ]);
  if (!completed)
    console.error(`Review UI failure trace retained in ${evidence}`);
}
