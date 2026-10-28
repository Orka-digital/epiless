import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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

export async function auth(
  context: BrowserContext,
  origin: string,
  email?: string,
) {
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

export async function signOut(context: BrowserContext, origin: string) {
  const response = await context.request.post('/api/auth/sign-out', {
    headers: { Origin: origin },
    data: {},
  });
  expect(response.ok()).toBe(true);
}

export async function queue(page: Page): Promise<UploadJob[]> {
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

export async function selectReport(page: Page, sensitive = false) {
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
