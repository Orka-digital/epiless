import { test, expect, type Page } from '@playwright/test';
import { exampleReport } from '../../apps/web/src/lib/example-report';

async function headMetadata(page: Page) {
  return page
    .locator('head meta')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute('content') || '')
        .join('\n'),
    );
}

test('report provenance separates supplied and server timestamps while all visibility states share a generic social image', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const network = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
  await context.setExtraHTTPHeaders({
    'CF-Connecting-IP': network,
    'X-Forwarded-For': network,
  });
  const request = async (path: string, data: unknown, method = 'POST') => {
    const response = await context.request.fetch(path, {
      method,
      headers: { Origin: baseURL! },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const challenge = await request('/api/security/challenge', {
    action: 'auth',
  });
  const signup = await context.request.post('/api/auth/sign-up/email', {
    headers: {
      Origin: baseURL!,
      'x-flashguard-challenge': challenge.id,
      'x-captcha-response': 'flashguard-local-test',
    },
    data: {
      name: 'Metadata Test Contributor',
      email: `metadata-${crypto.randomUUID()}@example.net`,
      password: 'Metadata-test-account-2026!',
    },
  });
  expect(signup.ok()).toBe(true);
  const hostname = `private-report-${crypto.randomUUID()}.example.net`;
  const privateText = 'PRIVATE_REPORT_BODY_MUST_NOT_ENTER_SOCIAL_METADATA';
  const report = {
    ...structuredClone(exampleReport),
    origin: `https://${hostname}`,
    limitations: [privateText],
    routes: exampleReport.routes.map((route) => ({
      ...route,
      url: `https://${hostname}/private-route`,
    })),
  };
  const intent = await request('/api/publications/intents', {
    report,
    visibility: 'PRIVATE',
    idempotencyKey: crypto.randomUUID(),
  });
  await request(`/api/publications/intents/${intent.id}/verify`, {
    token: 'flashguard-local-test',
    challengeId: intent.challenge.id,
  });
  let publication = await request('/api/publications', { intentId: intent.id });
  await page.goto(`/reports/${publication.id}`);
  await expect(
    page.getByRole('region', { name: 'Herkomst van het rapport' }),
  ).toContainText('Metadata Test Contributor');
  await expect(
    page.locator(`time[datetime="${report.startedAt}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`time[datetime="${publication.publishedAt}"]`),
  ).toBeVisible();
  await expect(
    page.getByText('Online bewaard (server)', { exact: true }),
  ).toBeVisible();
  expect(new Date(publication.publishedAt).getTime()).toBeGreaterThan(
    new Date(report.endedAt).getTime(),
  );
  const image = await page
    .locator('meta[property="og:image"]')
    .getAttribute('content');
  expect(image).toBe(`${baseURL}/social/epi-less-preview-v1.png`);
  expect(new URL(image!).search).toBe('');
  expect(await headMetadata(page)).not.toContain(hostname);
  expect(await headMetadata(page)).not.toContain(privateText);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex,nofollow',
  );
  const asset = await context.request.get(image!);
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toContain('image/png');
  const png = await asset.body();
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  expect(png.byteLength).toBeLessThan(64 * 1024);

  publication = await request(
    `/api/publications/${publication.id}`,
    {
      action: 'visibility',
      revision: publication.revision,
      visibility: 'PUBLIC',
    },
    'PATCH',
  );
  await page.reload();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    `Audit ${hostname} · epi-less`,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  expect(await headMetadata(page)).not.toContain(privateText);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    image!,
  );

  publication = await request(
    `/api/publications/${publication.id}`,
    {
      action: 'visibility',
      revision: publication.revision,
      visibility: 'UNLISTED',
    },
    'PATCH',
  );
  const guest = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const guestPage = await guest.newPage();
    expect((await guestPage.goto(publication.shareUrl))?.status()).toBe(200);
    const token = new URL(publication.shareUrl).searchParams.get('token')!;
    const meta = await headMetadata(guestPage);
    expect(meta).not.toContain(hostname);
    expect(meta).not.toContain(privateText);
    expect(meta).not.toContain(token);
    await expect(
      guestPage.locator('meta[property="og:image"]'),
    ).toHaveAttribute('content', image!);
    await expect(guestPage.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );

    publication = await request(
      `/api/publications/${publication.id}`,
      {
        action: 'visibility',
        revision: publication.revision,
        visibility: 'PUBLIC',
      },
      'PATCH',
    );
    publication = await request(
      `/api/publications/${publication.id}`,
      { action: 'revoke', revision: publication.revision },
      'PATCH',
    );
    await page.reload();
    expect(
      (await context.request.get(`/reports/${publication.id}`)).status(),
    ).toBe(200);
    expect(await headMetadata(page)).not.toContain(hostname);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );
    expect((await guestPage.goto(`/reports/${publication.id}`))?.status()).toBe(
      404,
    );
    expect(await headMetadata(guestPage)).not.toContain(hostname);
    await expect(
      guestPage.locator('meta[property="og:image"]'),
    ).toHaveAttribute('content', image!);
  } finally {
    await guest.close();
  }
});
