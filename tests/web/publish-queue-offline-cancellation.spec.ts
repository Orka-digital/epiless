import { expect, test } from '@playwright/test';

import AxeBuilder from '@axe-core/playwright';

import { auth, queue, selectReport, signOut } from './publish-queue.fixture';
test.describe('publish-queue', () => {
  // API calls create real local accounts; only the deliberately interrupted request
  // is intercepted. Assertions inspect persistent browser storage and the local D1 API.
  test('approved redacted upload survives offline reload and pauses across account changes', async ({
    page,
    context,
    baseURL,
  }) => {
    const firstEmail = await auth(context, baseURL!);
    await page.goto('/publish');
    await selectReport(page, true);
    await page.getByText('Exacte geselecteerde inhoud bekijken').click();
    expect(await page.locator('form pre').textContent()).not.toContain(
      'private-customer',
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    for (const width of [320, 390, 640]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
        `preview reflow at ${width}px`,
      ).toBe(true);
    }
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Rapport online bewaren' }).click();
    await expect.poll(async () => (await queue(page))[0]?.state).toBe('RETRY');
    const original = (await queue(page))[0]!;
    expect(original.visibility).toBe('PRIVATE');
    expect(JSON.stringify(original.report)).not.toContain('private-customer');
    expect(original.report.routes[0]!.url).toBe('https://example.org/route-1');
    expect(JSON.stringify(original)).not.toContain('flashguard-local-test');
    await context.setOffline(false);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Lokale uploadwachtrij' }),
    ).toBeVisible();
    expect((await queue(page))[0]!.idempotencyKey).toBe(
      original.idempotencyKey,
    );
    expect((await queue(page))[0]!.contentHash).toBe(original.contentHash);
    await page.getByText('Bewaarde goedgekeurde snapshot').click();
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      'persisted snapshot reflow at 320px',
    ).toBe(true);

    await signOut(context, baseURL!);
    await auth(context, baseURL!);
    await page.reload();
    await expect(page.getByText(/ander account/).last()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Opnieuw proberen' }),
    ).toBeDisabled();
    expect(
      (await (await context.request.get('/api/publications')).json()).items,
    ).toHaveLength(0);
    await signOut(context, baseURL!);
    await auth(context, baseURL!, firstEmail);
    await page.reload();
    const retry = page.getByRole('button', { name: 'Opnieuw proberen' });
    await expect(retry).toBeEnabled({ timeout: 10_000 });
    await retry.click();
    await expect(
      page.getByRole('heading', { name: 'Je rapport staat online.' }),
    ).toBeVisible();
    const completed = (await queue(page))[0]!;
    expect(completed.state).toBe('COMPLETE');
    expect(completed.idempotencyKey).toBe(original.idempotencyKey);
    const items = (
      await (await context.request.get('/api/publications')).json()
    ).items;
    expect(items).toHaveLength(1);
    const published = await (
      await context.request.get(`/api/publications/${items[0].id}`)
    ).json();
    expect(published.contentHash).toBe(original.contentHash);
    expect(published.report).toEqual(original.report);
  });

  test('cancelling during verification survives reload and blocks the late verification response', async ({
    page,
    context,
    baseURL,
  }) => {
    await auth(context, baseURL!);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let verifyStarted = false;
    await page.route('**/api/publications/intents/*/verify', async (route) => {
      verifyStarted = true;
      await held;
      await route.continue();
    });
    await page.goto('/publish');
    await selectReport(page);
    await page.getByRole('button', { name: 'Rapport online bewaren' }).click();
    await expect.poll(() => verifyStarted).toBe(true);
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        response.url().includes('/api/publications/intents/'),
    );
    await page.getByRole('button', { name: 'Opdracht annuleren' }).click();
    expect((await deleted).status()).toBe(200);
    release();
    await expect
      .poll(async () => (await queue(page))[0]?.state)
      .toBe('CANCELLED');
    await page.reload();
    await expect(page.getByText(/Lokaal geannuleerd/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Opnieuw proberen' }),
    ).toHaveCount(0);
    expect(
      (await (await context.request.get('/api/publications')).json()).items,
    ).toHaveLength(0);
    const saved = (await queue(page))[0]!;
    const attempt = await context.request.post('/api/publications/intents', {
      headers: { Origin: baseURL! },
      data: {
        report: saved.report,
        visibility: saved.visibility,
        idempotencyKey: saved.idempotencyKey,
        contentHash: saved.contentHash,
        expectedAccountId: saved.accountId,
      },
    });
    expect(attempt.status()).toBe(409);
    expect((await attempt.json()).error.code).toBe('INTENT_CANCELLED');
  });
});
