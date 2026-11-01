import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fixture, send, storeJob } from './browser-smoke-fixture.mjs';
/** Assert persisted numeric evidence, static diagnostics and accessible exact exports.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} profile
 * @param {Awaited<ReturnType<typeof import('./browser-storage-migration.mjs').testStorageMigration>>} numericEngine
 */
export async function testDiagnosticExports(
  page,
  context,
  profile,
  numericEngine,
) {
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
  const saved = (await send(page, { type: 'GET_STATE' })).value.jobs.find(
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
}
