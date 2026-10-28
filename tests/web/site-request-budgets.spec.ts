import { expect, test } from '@playwright/test';

import { gzipSync } from 'node:zlib';

import { mkdir, writeFile } from 'node:fs/promises';

import './site.fixture';
test.describe('site', () => {
  test('production first-render requests fit budgets including inline island bootstrap', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const measurements: Record<string, unknown>[] = [];
    for (const route of ['/', '/sites', '/voorbeeld', '/account', '/publish']) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      const responses: { type: string; bytes: Buffer; url: string }[] = [];
      const pending: Promise<void>[] = [];
      page.on('response', (response) => {
        pending.push(
          (async () => {
            const type = response.request().resourceType();
            if (
              !['script', 'stylesheet', 'font', 'document', 'image'].includes(
                type,
              ) ||
              (response.status() >= 300 && response.status() < 400)
            )
              return;
            responses.push({
              type,
              bytes: await response.body(),
              url: response.url(),
            });
          })(),
        );
      });
      await page.goto(route);
      if (route === '/account')
        await expect(
          page.getByRole('button', { name: 'Aanmelden', exact: true }).last(),
        ).toBeEnabled();
      if (route === '/publish')
        await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      await Promise.all(pending);
      const inline = await page
        .locator('script:not([src])')
        .evaluateAll((elements) =>
          elements
            .filter((e) => !e.getAttribute('type')?.includes('json'))
            .map((e) => e.textContent || ''),
        );
      const js =
        responses
          .filter((r) => r.type === 'script')
          .reduce((sum, r) => sum + gzipSync(r.bytes).length, 0) +
        inline
          .filter(Boolean)
          .reduce((sum, text) => sum + gzipSync(text).length, 0);
      const css = responses
        .filter((r) => r.type === 'stylesheet')
        .reduce((sum, r) => sum + gzipSync(r.bytes).length, 0);
      const fonts = responses
        .filter((r) => r.type === 'font')
        .reduce((sum, r) => sum + r.bytes.length, 0);
      const total = responses.reduce(
        (sum, r) =>
          sum + (r.type === 'font' ? r.bytes.length : gzipSync(r.bytes).length),
        0,
      );
      expect(js, `${route} JS`).toBeLessThanOrEqual(
        (['/account', '/publish'].includes(route) ? 100 : 5) * 1024,
      );
      expect(css).toBeLessThanOrEqual(30 * 1024);
      expect(fonts).toBeLessThanOrEqual(100 * 1024);
      expect(responses.filter((r) => r.type === 'font')).toHaveLength(0);
      expect(total).toBeLessThanOrEqual(450 * 1024);
      expect(
        responses.some((r) => r.url.includes('challenges.cloudflare.com')),
      ).toBe(false);
      measurements.push({ route, js, css, fonts, total });
      await context.close();
    }
    await mkdir('artifacts', { recursive: true });
    await writeFile(
      'artifacts/first-render-budgets.json',
      JSON.stringify(measurements, null, 2),
    );
    await testInfo.attach('first-render-budgets.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
  });
});
