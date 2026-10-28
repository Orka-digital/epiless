import { expect, test } from '@playwright/test';

import { exampleReport } from '../../apps/web/src/lib/example-report';
import './site.fixture';
test.describe('site', () => {
  test('real account and explicit private, unlisted and public snapshots with withdrawal', async ({
    page,
    browser,
    baseURL,
  }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto('/account');
    await page
      .getByRole('button', { name: 'Account maken', exact: true })
      .click();
    await page.getByLabel('Openbare naam').fill('Browser Test Contributor');
    await page
      .getByLabel('E-mailadres')
      .fill(`browser-${crypto.randomUUID()}@example.net`);
    await page.locator('input[name="password"]').fill('Local-test-account-48!');
    await page.getByRole('button', { name: 'Maak mijn account' }).click();
    await expect(
      page.getByRole('heading', { name: 'Mijn rapporten', exact: true }),
    ).toBeVisible();
    const guest = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
    });
    const guestPage = await guest.newPage();
    const urls: Record<string, string> = {};
    for (const visibility of ['PRIVATE', 'UNLISTED', 'PUBLIC']) {
      await page.goto('/publish');
      await expect(
        page.getByLabel('Kies een lokale JSON-export'),
      ).toBeEnabled();
      await page.getByLabel('Kies een lokale JSON-export').setInputFiles({
        name: 'synthetic-audit.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            ...exampleReport,
            id: `browser-${crypto.randomUUID()}`,
          }),
        ),
      });
      await expect(
        page.getByRole('heading', { name: 'example.org', level: 2 }),
      ).toBeVisible();
      await page
        .getByLabel('Wie mag het rapport zien?')
        .selectOption(visibility);
      await expect(
        page.getByRole('button', { name: 'Rapport online bewaren' }),
      ).toBeDisabled();
      await page.getByLabel('Ik heb de geselecteerde inhoud').check();
      await page
        .getByRole('button', { name: 'Rapport online bewaren' })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Je rapport staat online.' }),
      ).toBeVisible();
      const href = await page
        .getByRole('link', { name: 'Open het rapport' })
        .getAttribute('href');
      expect(href).toBeTruthy();
      urls[visibility] = href!;
      const response = await guestPage.goto(href!);
      expect(response?.status()).toBe(visibility === 'PRIVATE' ? 404 : 200);
      expect(response?.headers()['cache-control']).toContain('no-store');
      if (visibility === 'UNLISTED') {
        expect(href).toContain('token=');
        expect(
          await guestPage
            .locator('meta[name="robots"]')
            .getAttribute('content'),
        ).toContain('noindex');
        const bare = new URL(href!, baseURL);
        bare.search = '';
        expect((await guestPage.goto(bare.href))?.status()).toBe(404);
      }
    }
    await guestPage.goto('/sites?q=example.org');
    const publicPath = new URL(urls.PUBLIC, baseURL).pathname;
    await expect(guestPage.locator(`a[href="${publicPath}"]`)).toBeVisible();
    expect(
      await guestPage
        .locator(`a[href="${new URL(urls.PRIVATE, baseURL).pathname}"]`)
        .count(),
    ).toBe(0);
    await page.goto(urls.PUBLIC);
    await page
      .getByRole('link', { name: 'Een probleem met dit rapport melden' })
      .click();
    await page.getByLabel('Soort probleem').selectOption('misleading');
    await page
      .getByLabel('Wat klopt er niet?')
      .fill('Synthetic browser test: this example needs a manual review.');
    await page.getByRole('button', { name: 'Melding versturen' }).click();
    await expect(page.getByText('Je melding is ontvangen.')).toBeVisible();
    await page.goto('/account');
    const publicCard = page
      .locator('article')
      .filter({ has: page.locator(`a[href$="${publicPath}"]`) });
    await publicCard
      .getByRole('button', { name: 'Intrekken', exact: true })
      .click();
    await publicCard
      .getByRole('button', { name: 'Trek in', exact: true })
      .click();
    await expect(
      page.locator('article').filter({ hasText: 'Ingetrokken' }),
    ).toHaveCount(1);
    expect((await guestPage.goto(urls.PUBLIC))?.status()).toBe(404);
    await guestPage.goto('/sites?q=example.org');
    expect(await guestPage.locator(`a[href="${publicPath}"]`).count()).toBe(0);
    const unlistedPath = new URL(urls.UNLISTED).pathname;
    const unlistedCard = page
      .locator('article')
      .filter({ has: page.locator(`a[href*="${unlistedPath}"]`) });
    await unlistedCard
      .getByRole('button', { name: 'Verwijderen', exact: true })
      .click();
    await unlistedCard
      .getByRole('button', { name: 'Verwijder online', exact: true })
      .click();
    await expect(
      page.locator('article').filter({ hasText: 'Verwijderd' }),
    ).toHaveCount(1);
    expect((await guestPage.goto(urls.UNLISTED))?.status()).toBe(404);
    await page.getByRole('button', { name: 'Uitloggen', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Aanmelden', exact: true }),
    ).toBeVisible();
    expect((await page.goto(urls.PRIVATE))?.status()).toBe(404);
    expect(failures).toEqual([]);
    await guest.close();
  });
});
