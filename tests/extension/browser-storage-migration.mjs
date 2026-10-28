import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixture } from './browser-smoke-fixture.mjs';
/** Check real IndexedDB migration and numeric engine execution.
 * @param {string} profile
 */
export async function testStorageMigration(profile) {
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
  const migrationBrowser = await chromium.launch({
    channel: 'chromium',
    headless: true,
  });
  try {
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
    assert.equal(
      numericEngine.measurement.findings[0].qualifyingTransitions,
      7,
    );
    assert.equal(
      numericEngine.measurement.findings[0].diagnostic.complete,
      true,
    );
    assert.ok(
      numericEngine.measurement.findings[0].diagnostic.samples.length > 7,
    );
    return numericEngine;
  } finally {
    await migrationBrowser.close();
  }
}
