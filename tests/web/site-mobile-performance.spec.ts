import { expect, test } from '@playwright/test';

import { mkdir, writeFile } from 'node:fs/promises';

import './site.fixture';
test.describe('site', () => {
  test('fixed mobile lab: median of three cold LCP and CLS runs', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(90000);
    const measurements: {
      route: string;
      runs: { lcp: number; cls: number }[];
      medianLcp: number;
      medianCls: number;
    }[] = [];
    for (const route of ['/', '/sites', '/voorbeeld']) {
      const runs: { lcp: number; cls: number }[] = [];
      for (let run = 0; run < 3; run++) {
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 1,
          isMobile: true,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 150,
          downloadThroughput: 1_600_000 / 8,
          uploadThroughput: 750_000 / 8,
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.addInitScript(() => {
          const values = { lcp: 0, cls: 0 };
          (window as Window & { lab: typeof values }).lab = values;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) values.lcp = entry.startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & {
                hadRecentInput: boolean;
                value: number;
              };
              if (!shift.hadRecentInput) values.cls += shift.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        });
        expect((await page.goto(route))?.status()).toBe(200);
        await page.evaluate(() => document.fonts.ready);
        // A fixed observation window after fonts settle, not a user-interaction wait.
        await page.waitForTimeout(1500);
        runs.push(
          await page.evaluate(
            () =>
              (window as Window & { lab: { lcp: number; cls: number } }).lab,
          ),
        );
        await context.close();
      }
      const medianLcp = runs.map((run) => run.lcp).sort((a, b) => a - b)[1];
      const medianCls = runs.map((run) => run.cls).sort((a, b) => a - b)[1];
      measurements.push({ route, runs, medianLcp, medianCls });
      expect(medianLcp).toBeGreaterThan(0);
      expect(medianLcp, `${route} median LCP`).toBeLessThanOrEqual(2500);
      expect(medianCls, `${route} median CLS`).toBeLessThanOrEqual(0.1);
    }
    await mkdir('artifacts', { recursive: true });
    await writeFile(
      'artifacts/mobile-lab.json',
      JSON.stringify(
        {
          profile:
            '390x844 DPR1; 4x CPU; 150ms RTT; 1.6 Mbps down; 750 Kbps up; cold cache; three runs',
          measurements,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('mobile-lab.json', {
      body: JSON.stringify(
        {
          profile:
            '390x844 DPR1; 4x CPU; 150ms RTT; 1.6 Mbps down; 750 Kbps up; cold cache; three runs',
          measurements,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
});
