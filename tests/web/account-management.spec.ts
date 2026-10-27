import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { exampleReport } from '../../apps/web/src/lib/example-report';

async function seedReport(
  page: Page,
  origin: string,
  visibility: 'PUBLIC' | 'PRIVATE',
) {
  return page.evaluate(
    async ({ report, visibility }) => {
      const post = async (path: string, input: unknown) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(data));
        return data;
      };
      const intent = await post('/api/publications/intents', {
        report,
        visibility,
        idempotencyKey: crypto.randomUUID(),
      });
      await post(`/api/publications/intents/${intent.id}/verify`, {
        challengeId: intent.challenge.id,
        token: 'flashguard-local-test',
      });
      return post('/api/publications', { intentId: intent.id });
    },
    {
      report: {
        ...exampleReport,
        id: crypto.randomUUID(),
        origin,
        startedAt: '2026-10-20T10:00:00.000Z',
        endedAt: '2026-10-20T10:00:20.000Z',
        routes: exampleReport.routes.map((route) => ({
          ...route,
          url: route.url.replace(exampleReport.origin, origin),
          scenarios: route.scenarios.map((scenario) => ({
            ...scenario,
            startedAt: '2026-10-20T10:00:00.000Z',
            endedAt: '2026-10-20T10:00:20.000Z',
          })),
        })),
      },
      visibility,
    },
  ) as Promise<{ id: string }>;
}

test('owner manages visibility, rotates links, filters scopes, exports and erases the account with password confirmation', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
  await page.context().setExtraHTTPHeaders({
    'CF-Connecting-IP': `2001:db8:${crypto.randomUUID().slice(0, 4)}::90`,
    'X-Forwarded-For': `2001:db8:${crypto.randomUUID().slice(0, 4)}::90`,
  });
  const password = 'Account-management-test-2026!';
  const email = `manage-${crypto.randomUUID()}@example.net`;
  const origin = `https://manage-${crypto.randomUUID()}.example.net`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/account');
  await page
    .getByRole('button', { name: 'Account maken', exact: true })
    .click();
  await page.getByLabel('Openbare naam').fill('Account Management Test');
  await page.getByLabel('E-mailadres').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Maak mijn account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Mijn rapporten', exact: true }),
  ).toBeVisible();
  const first = await seedReport(page, origin, 'PRIVATE');
  const second = await seedReport(page, origin, 'PRIVATE');
  await page.reload();
  const card = () =>
    page
      .locator('article')
      .filter({ has: page.locator(`a[href*="/reports/${first.id}"]`) });
  const guest = await browser.newContext({ baseURL, javaScriptEnabled: false });
  await guest.setExtraHTTPHeaders({
    'CF-Connecting-IP': `2001:db8:${crypto.randomUUID().slice(0, 4)}::91`,
  });
  const guestPage = await guest.newPage();
  expect((await guestPage.goto(`/reports/${first.id}`))?.status()).toBe(404);
  await card().getByRole('combobox').selectOption('PUBLIC');
  await card().getByRole('button', { name: 'Zichtbaarheid wijzigen' }).click();
  await card().getByRole('button', { name: 'Bevestig wijziging' }).click();
  await expect(card().getByRole('combobox')).toHaveValue('PUBLIC');
  expect((await guestPage.goto(`/reports/${first.id}`))?.status()).toBe(200);

  await guestPage.goto(`/sites?q=${new URL(origin).hostname}`);
  await guestPage.locator('.index-filter-disclosure > summary').click();
  await guestPage
    .getByLabel('Meetuitkomst', { exact: true })
    .selectOption(exampleReport.status);
  await guestPage.getByLabel('Gemeten vanaf (UTC)').fill('2026-10-20');
  await guestPage.getByLabel('Gemeten tot en met (UTC)').fill('2026-10-20');
  await guestPage
    .getByLabel('Criterium', { exact: true })
    .selectOption('2.3.1');
  await guestPage.getByRole('button', { name: 'Zoeken' }).click();
  await expect(
    guestPage.locator(`a[href="/reports/${first.id}"]`),
  ).toBeVisible();
  await expect(
    guestPage.locator(`a[href="/reports/${second.id}"]`),
  ).toHaveCount(0);
  await guestPage
    .getByRole('link', { name: 'Alle rapporten van dit domein' })
    .click();
  await expect(
    guestPage.getByRole('heading', { name: 'Openbare meetgeschiedenis' }),
  ).toBeVisible();
  await expect(
    guestPage.getByText('Scope van de recentste meting:', { exact: false }),
  ).toBeVisible();
  await expect(
    guestPage.locator(`a[href="/reports/${second.id}"]`),
  ).toHaveCount(0);
  await guestPage.goto(`/sites?q=${new URL(origin).hostname}&from=2026-10-21`);
  await expect(guestPage.locator(`a[href="/reports/${first.id}"]`)).toHaveCount(
    0,
  );

  await card().getByRole('combobox').selectOption('UNLISTED');
  await card().getByRole('button', { name: 'Zichtbaarheid wijzigen' }).click();
  await card().getByRole('button', { name: 'Bevestig wijziging' }).click();
  await expect(card().getByRole('combobox')).toHaveValue('UNLISTED');
  const previous = await card().locator('h2 a').getAttribute('href');
  expect(previous).toContain('token=');
  expect((await guestPage.goto(previous!))?.status()).toBe(200);
  await card().getByRole('button', { name: 'Deellink vervangen' }).click();
  await card().getByRole('button', { name: 'Bevestig wijziging' }).click();
  await expect(card().locator('h2 a')).not.toHaveAttribute('href', previous!);
  const next = await card().locator('h2 a').getAttribute('href');
  expect((await guestPage.goto(previous!))?.status()).toBe(404);
  expect((await guestPage.goto(next!))?.status()).toBe(200);
  expect((await guestPage.goto(`/reports/${first.id}`))?.status()).toBe(404);

  const account = page.getByRole('region', { name: 'Accountgegevens' });
  await account.getByRole('button', { name: 'Account exporteren' }).click();
  await account.getByLabel('Huidig wachtwoord').fill('not-the-password');
  await account
    .getByRole('button', { name: 'Download accountgegevens' })
    .click();
  await expect(account.getByRole('status')).toContainText(
    'Je wachtwoord kon niet worden bevestigd',
  );
  await account.getByLabel('Huidig wachtwoord').fill(password);
  const downloadPromise = page.waitForEvent('download');
  await account
    .getByRole('button', { name: 'Download accountgegevens' })
    .click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.account.email).toBe(email);
  expect(exported.publications).toHaveLength(2);
  expect(exported.publications.map((p: { id: string }) => p.id).sort()).toEqual(
    [first.id, second.id].sort(),
  );
  expect(exported).not.toHaveProperty('password');
  expect(
    exported.sessions.every(
      (session: Record<string, unknown>) => !('token' in session),
    ),
  ).toBe(true);

  await page.evaluate(
    async ({ accountId, report }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('flashguard-approved-uploads', 1);
        open.onupgradeneeded = () =>
          open.result.createObjectStore('jobs', { keyPath: 'id' });
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('jobs', 'readwrite');
        for (const [id, owner] of [
          ['remove-owner', accountId],
          ['keep-other', 'different-account'],
        ])
          transaction
            .objectStore('jobs')
            .put({ id, accountId: owner, report, state: 'PAUSED' });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    },
    { accountId: exported.account.id as string, report: exampleReport },
  );
  await account
    .getByRole('button', { name: 'Account verwijderen', exact: true })
    .click();
  await account.getByLabel('Huidig wachtwoord').fill(password);
  await account.getByLabel('Typ VERWIJDER ter bevestiging').fill('VERWIJDER');
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await account
    .getByRole('button', { name: 'Verwijder account definitief' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Aanmelden', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Je account en online rapporten zijn verwijderd.',
  );
  expect((await guestPage.goto(next!))?.status()).toBe(404);
  const localJobs = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('flashguard-approved-uploads', 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const jobs = await new Promise<{ id: string }[]>((resolve, reject) => {
      const request = db.transaction('jobs').objectStore('jobs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return jobs.map((job) => job.id);
  });
  expect(localJobs).toEqual(['keep-other']);
  expect((await page.goto(`/reports/${second.id}`))?.status()).toBe(404);
  expect(errors).toEqual([]);
  await guest.close();
});
