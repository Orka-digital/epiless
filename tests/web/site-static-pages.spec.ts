import { expect, test } from '@playwright/test';

import AxeBuilder from '@axe-core/playwright';

import './site.fixture';
test.describe('site', () => {
  test('public pages work without JavaScript and keep their rendering budgets', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL,
    });
    const page = await context.newPage();
    for (const route of [
      '/',
      '/docs',
      '/download',
      '/privacy',
      '/over',
      '/sites',
      '/voorbeeld',
    ]) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.locator('main h1')).toBeVisible();
      expect(await page.locator('astro-island').count()).toBe(0);
      expect(
        await page.locator('script[src*="challenges.cloudflare.com"]').count(),
      ).toBe(0);
    }
    await page.goto('/sites');
    await page.getByRole('searchbox').fill('not-yet-scanned.example');
    await page.getByRole('button', { name: 'Zoeken' }).click();
    await expect(
      page.getByRole('heading', {
        name: 'Nog geen rapport voor deze zoekopdracht.',
      }),
    ).toBeVisible();
    await context.close();
  });

  test('keyboard, mobile reflow, reduced motion and accessible public pages', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const route of [
      '/',
      '/sites',
      '/sites/site',
      '/voorbeeld',
      '/docs',
      '/download',
      '/privacy',
      '/over',
      '/account',
      '/account/reset',
      '/account/moderation',
      '/publish',
      '/report-abuse',
      '/nonexistent-layout-check',
    ]) {
      await page.goto(route);
      if (route === '/account')
        await expect(page.getByLabel('E-mailadres')).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect.soft(results.violations, route).toEqual([]);
      for (const width of [320, 390, 640]) {
        await page.setViewportSize({ width, height: 844 });
        expect
          .soft(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
            `${route} reflow at ${width}px`,
          )
          .toBe(true);
      }
    }
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Ga naar inhoud' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#inhoud')).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: 'artifacts/epi-less-mobile.png',
      fullPage: true,
    });
  });
});
