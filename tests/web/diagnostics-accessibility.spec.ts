import { expect, test } from '@playwright/test';

import AxeBuilder from '@axe-core/playwright';

import { mkdir } from 'node:fs/promises';

import { openReportDetails } from './diagnostics.fixture';
test.describe('diagnostics', () => {
  test('numeric diagnostics remain static, accessible and readable at 320px without JavaScript', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 900 },
    });
    try {
      const page = await context.newPage();
      const scripts: string[] = [];
      const policyErrors: string[] = [];
      page.on('console', (message) => {
        if (/violates.*Content Security Policy/i.test(message.text()))
          policyErrors.push(message.text());
      });
      page.on('request', (request) => {
        if (request.resourceType() === 'script') scripts.push(request.url());
      });
      expect((await page.goto('/voorbeeld'))?.status()).toBe(200);
      await expect(page.locator('astro-island, script[src]')).toHaveCount(0);
      await openReportDetails(page);

      const diagnostic = page.locator('.finding-diagnostics').first();
      await expect(diagnostic).toBeVisible();
      await expect(
        diagnostic.getByRole('img', {
          name: 'Statisch meetspoor: relatieve luminantie en aandeel rood, beide van nul tot één',
        }),
      ).toBeVisible();
      await expect(
        diagnostic.getByRole('img', {
          name: 'Schematische kandidaatregio in het analyseframe; de stip is de meetpixel',
        }),
      ).toBeVisible();
      await expect(diagnostic.locator('svg path')).not.toHaveCount(0);
      await expect(
        diagnostic.locator(
          'svg animate, svg animateTransform, svg set, video, canvas, iframe, script',
        ),
      ).toHaveCount(0);
      await expect(diagnostic).toContainText('7 kwalificerende overgangen');
      await expect(diagnostic).toContainText('8 echte pixelsamples');
      await expect(diagnostic).toContainText(
        'geen bewezen oorzaak van de gemeten flits',
      );
      await expect(
        diagnostic.getByRole('heading', {
          name: 'Mogelijke elementen op deze locatie',
        }),
      ).toBeVisible();
      await expect(diagnostic.locator('code')).toHaveText(
        '*:nth-child(1) > *:nth-child(2) > *:nth-child(1)',
      );
      const samples = diagnostic.getByRole('table', {
        name: 'Analysepixel: tijd in ms en sRGB-kanalen van 0 tot 255',
      });
      await expect(samples).toBeVisible();
      await expect(samples.locator('tbody tr')).toHaveCount(8);
      await expect(
        samples.locator('tbody tr').first().locator('td'),
      ).toHaveText(['2000.00', '0', '0', '0']);
      await expect(samples.locator('tbody tr').last().locator('td')).toHaveText(
        ['2875.00', '255', '255', '255'],
      );

      await mkdir('artifacts', { recursive: true });
      await page.screenshot({
        path: 'artifacts/diagnostics-desktop.png',
        fullPage: true,
      });
      await page.setViewportSize({ width: 320, height: 844 });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await expect(samples).toBeVisible();
      await expect(diagnostic.locator('code')).toBeVisible();
      await page.screenshot({
        path: 'artifacts/diagnostics-mobile.png',
        fullPage: true,
      });
      expect(scripts).toEqual([]);
      expect(policyErrors).toEqual([]);
      // Axe needs JavaScript timers to finish its injected audit. The original
      // context above independently proves all report interactions without JS.
      const auditContext = await browser.newContext({
        baseURL,
        viewport: { width: 320, height: 844 },
        reducedMotion: 'reduce',
      });
      try {
        const auditPage = await auditContext.newPage();
        await auditPage.goto('/voorbeeld');
        await openReportDetails(auditPage);
        const accessibility = await new AxeBuilder({ page: auditPage })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(accessibility.violations).toEqual([]);
      } finally {
        await auditContext.close();
      }
    } finally {
      await context.close();
    }
  });
});
