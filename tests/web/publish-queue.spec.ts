import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { exampleReport } from '../../apps/web/src/lib/example-report';
import type { UploadJob } from '../../apps/web/src/lib/upload-queue';

const password = 'Local-queue-test-password-48!';
test.beforeEach(async ({ context }) => {
  // Distinct local simulated network actors keep the real rate limiter enabled
  // without making independent test accounts consume each other's IP quota.
  const network = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
  await context.setExtraHTTPHeaders({
    'CF-Connecting-IP': network,
    'X-Forwarded-For': network,
  });
});
async function auth(context: BrowserContext, origin: string, email?: string) {
  const challengeResponse = await context.request.post(
    '/api/security/challenge',
    {
      headers: { Origin: origin },
      data: { action: 'auth' },
    },
  );
  expect(challengeResponse.ok()).toBe(true);
  const challenge = await challengeResponse.json();
  const address = email || `queue-${crypto.randomUUID()}@example.net`;
  const response = await context.request.post(
    `/api/auth/${email ? 'sign-in' : 'sign-up'}/email`,
    {
      headers: {
        Origin: origin,
        'x-flashguard-challenge': challenge.id,
        'x-captcha-response': 'flashguard-local-test',
      },
      data: { name: 'Queue Test Contributor', email: address, password },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return address;
}
async function signOut(context: BrowserContext, origin: string) {
  const response = await context.request.post('/api/auth/sign-out', {
    headers: { Origin: origin },
    data: {},
  });
  expect(response.ok()).toBe(true);
}
async function queue(page: Page): Promise<UploadJob[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('flashguard-approved-uploads', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('jobs', 'readonly');
          const request = tx.objectStore('jobs').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
async function selectReport(page: Page, sensitive = false) {
  const report = structuredClone(exampleReport);
  if (sensitive) {
    report.id = 'private-customer-identifier';
    report.routes[0]!.url =
      'https://example.org/private-customer?token=private-customer#private-customer';
    report.routes[0]!.reason = 'private-customer-route-note';
    report.job.stopReason = 'private-customer-stop';
    report.limitations = ['private-customer-limit'];
    report.routes[0]!.scenarios[0]!.type = 'private-customer-scenario';
    report.routes[0]!.scenarios[0]!.findings[0]!.message =
      'private-customer-finding';
  }
  const input = page.getByLabel('Kies een lokale JSON-export');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: 'queue-audit.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(report)),
  });
  await expect(
    page.getByRole('heading', { name: 'example.org', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Ik heb de geselecteerde inhoud').check();
}

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
  expect((await queue(page))[0]!.idempotencyKey).toBe(original.idempotencyKey);
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
  const items = (await (await context.request.get('/api/publications')).json())
    .items;
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
  const before = (await (await context.request.get('/api/publications')).json())
    .items;
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
  const after = (await (await context.request.get('/api/publications')).json())
    .items;
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(before[0].id);
  expect(after[0].state).toBe('REVOKED');
  expect((await queue(page))[0]!.idempotencyKey).toBe(original.idempotencyKey);
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
    await page.getByRole('button', { name: 'Rapport online bewaren' }).click();
    await expect.poll(async () => (await queue(page))[0]?.state).toBe('RETRY');
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
