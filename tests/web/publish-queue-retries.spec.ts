import { chromium, expect, test, type BrowserContext } from '@playwright/test';

import { mkdtemp, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { auth, queue, selectReport } from './publish-queue.fixture';
test.describe('publish-queue', () => {
  test('lost commit response retries the same publication and never resurrects a later withdrawal', async ({
    page,
    context,
    baseURL,
  }) => {
    await auth(context, baseURL!);
    let commits = 0;
    await page.route(`${baseURL}/api/publications`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      commits++;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('connectionreset');
    });
    await page.goto('/publish');
    await selectReport(page);
    await page.getByRole('button', { name: 'Rapport online bewaren' }).click();
    await expect.poll(async () => (await queue(page))[0]?.state).toBe('RETRY');
    const original = (await queue(page))[0]!;
    const before = (
      await (await context.request.get('/api/publications')).json()
    ).items;
    expect(before).toHaveLength(1);
    expect(commits).toBe(1);
    const revoke = await context.request.patch(
      `/api/publications/${before[0].id}`,
      {
        headers: { Origin: baseURL! },
        data: { action: 'revoke', revision: before[0].revision },
      },
    );
    expect(revoke.status()).toBe(200);
    await page.reload();
    const retry = page.getByRole('button', { name: 'Opnieuw proberen' });
    await expect(retry).toBeEnabled({ timeout: 10_000 });
    await retry.click();
    await expect(
      page.getByRole('heading', { name: 'Deze opdracht was al verwerkt.' }),
    ).toBeVisible();
    expect(commits).toBe(1);
    const after = (
      await (await context.request.get('/api/publications')).json()
    ).items;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].state).toBe('REVOKED');
    expect((await queue(page))[0]!.idempotencyKey).toBe(
      original.idempotencyKey,
    );
  });

  test('rate-limit response persists its Retry-After cooldown without an automatic request loop', async ({
    page,
    context,
    baseURL,
  }) => {
    await auth(context, baseURL!);
    let attempts = 0;
    await page.route('**/api/publications/intents', async (route) => {
      attempts++;
      await route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
        body: JSON.stringify({
          error: {
            code: 'ACCOUNT_QUOTA',
            message: 'Lokale test: wacht één minuut.',
          },
        }),
      });
    });
    await page.goto('/publish');
    await selectReport(page);
    await page.getByRole('button', { name: 'Rapport online bewaren' }).click();
    await expect.poll(async () => (await queue(page))[0]?.state).toBe('RETRY');
    const saved = (await queue(page))[0]!;
    expect(saved.retryAt - Date.now()).toBeGreaterThan(55_000);
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Opnieuw proberen' }),
    ).toBeDisabled();
    await expect(
      page.getByText(/Opnieuw proberen over \d+ seconden/),
    ).toBeVisible();
    expect(attempts).toBe(1);
  });

  test('approved snapshot and account binding survive an actual browser process restart', async ({
    baseURL,
  }) => {
    const profile = await mkdtemp(join(tmpdir(), 'flashguard-upload-restart-'));
    const network = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
    const options = {
      headless: true,
      baseURL,
      extraHTTPHeaders: {
        'CF-Connecting-IP': network,
        'X-Forwarded-For': network,
      },
    };
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, options);
      await auth(context, baseURL!);
      let page = await context.newPage();
      await page.goto('/publish');
      await selectReport(page, true);
      await context.setOffline(true);
      await page
        .getByRole('button', { name: 'Rapport online bewaren' })
        .click();
      await expect
        .poll(async () => (await queue(page))[0]?.state)
        .toBe('RETRY');
      const approved = (await queue(page))[0]!;
      await context.close();
      context = undefined;
      context = await chromium.launchPersistentContext(profile, options);
      page = await context.newPage();
      await page.goto('/publish');
      await expect(
        page.getByRole('heading', { name: 'Lokale uploadwachtrij' }),
      ).toBeVisible();
      const recovered = (await queue(page))[0]!;
      expect(recovered).toEqual(approved);
      await expect(
        page.getByRole('button', { name: 'Opnieuw proberen' }),
      ).toBeEnabled({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Opnieuw proberen' }).click();
      await expect(
        page.getByRole('heading', { name: 'Je rapport staat online.' }),
      ).toBeVisible();
      expect((await queue(page))[0]!.contentHash).toBe(approved.contentHash);
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
});
