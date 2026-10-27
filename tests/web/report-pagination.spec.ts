import { test, expect } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { exampleReport } from '../../apps/web/src/lib/example-report';

test('a large unlisted report remains complete across bounded SSR pages and full exports without JavaScript', async ({
  context,
  browser,
  baseURL,
}) => {
  const network = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
  await context.setExtraHTTPHeaders({
    'CF-Connecting-IP': network,
    'X-Forwarded-For': network,
  });
  const request = async (path: string, data: unknown) => {
    const response = await context.request.post(path, {
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
      name: 'Large Report Contributor',
      email: `pagination-${crypto.randomUUID()}@example.net`,
      password: 'Pagination-test-account-2026!',
    },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
  const report = structuredClone(exampleReport);
  report.origin = `https://pagination-${crypto.randomUUID()}.example.net`;
  report.routes[0]!.url = `${report.origin}/large-route`;
  const scenario = report.routes[0]!.scenarios[0]!;
  scenario.quality = {
    ...scenario.quality,
    downsampled: true,
    width: 320,
    height: 180,
    captureWindowMs: 15000,
    leadingIdleMs: 400,
    trailingIdleMs: 13000,
    interrupted: true,
  };
  scenario.findings = Array.from({ length: 231 }, (_, index) => ({
    ...scenario.findings[0]!,
    id: `large-finding-${index}`,
    message: `Unique observation ${index}, requiring review in analysis coordinates.`,
    region: { x: 10, y: 8, width: 16, height: 12 },
  }));
  report.routes[0]!.scenarios.push(
    ...Array.from({ length: 14 }, (_, index) => ({
      ...scenario,
      id: `empty-scenario-${index}`,
      type: `Empty scenario ${index}`,
      findings: [],
    })),
  );
  report.routes.push({
    url: `${report.origin}/skipped-route`,
    status: 'SKIPPED',
    reason: 'No measurement was made for this discovered route.',
    scenarios: [],
  });
  report.job.discoveredRoutes = 2;
  report.limitations = Array.from(
    { length: 25 },
    (_, index) => `Unique limitation ${index}: this report is not normative.`,
  );
  const intent = await request('/api/publications/intents', {
    report,
    visibility: 'UNLISTED',
    idempotencyKey: crypto.randomUUID(),
  });
  await request(`/api/publications/intents/${intent.id}/verify`, {
    token: 'flashguard-local-test',
    challengeId: intent.challenge.id,
  });
  const publication = await request('/api/publications', {
    intentId: intent.id,
  });
  const token = new URL(publication.shareUrl).searchParams.get('token')!;
  const guest = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await guest.newPage();
    const scripts: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'script') scripts.push(req.url());
    });
    const firstResponse = await page.goto(publication.shareUrl);
    expect(firstResponse?.status()).toBe(200);
    expect(gzipSync(await firstResponse!.body()).byteLength).toBeLessThan(
      450 * 1024,
    );
    await expect(page.locator('astro-island, script[src]')).toHaveCount(0);
    await page.locator('.route-item > summary').first().click();
    await expect(page.locator('.scenario').first()).toContainText(
      'Meetvenster 15.00 s',
    );
    await expect(page.locator('.scenario').first()).toContainText(
      '13.00 s zonder nieuw frame',
    );
    await expect(page.locator('.scenario').first()).toContainText(
      'vanaf het eerste geanalyseerde frame',
    );
    await page.locator('.finding-measurement > summary').first().click();
    const measurement = page.locator('.finding-measurement').first();
    await expect(measurement).toContainText('12% van het geanalyseerde frame');
    await expect(measurement).toContainText('x=10, y=8, breedte=16, hoogte=12');
    await expect(measurement).toContainText(
      '320 × 180 px · verkleind voor analyse',
    );
    await expect(measurement).toContainText('niet bij CSS-pixels');
    await expect(measurement).toContainText(
      'Dit is geen gevalideerde WCAG-oppervlaktebeoordeling.',
    );
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    const findings: string[] = [];
    const scenarios = new Set<string>();
    const routes = new Set<string>();
    let detailPages = 0;
    while (true) {
      detailPages++;
      await expect(page.locator('.audit-stats')).toContainText('231');
      await expect(page.locator('.audit-stats')).toContainText('15');
      expect(new URL(page.url()).searchParams.get('token')).toBe(token);
      const ids = await page
        .locator('[data-finding-id]')
        .evaluateAll((elements) =>
          elements.map((el) => el.getAttribute('data-finding-id')!),
        );
      expect(ids.length).toBeLessThanOrEqual(50);
      expect(await page.locator('.scenario').count()).toBeLessThanOrEqual(5);
      findings.push(...ids);
      for (const id of await page
        .locator('[data-scenario-id]')
        .evaluateAll((elements) =>
          elements.map((el) => el.getAttribute('data-scenario-id')!),
        ))
        scenarios.add(id);
      for (const path of await page.locator('.route-title').allTextContents())
        routes.add(path);
      const next = page.getByRole('link', {
        name: 'Volgende details',
        exact: true,
      });
      if (!(await next.count())) break;
      await next.click();
    }
    expect(detailPages).toBe(8);
    expect(findings).toEqual(scenario.findings.map((finding) => finding.id));
    expect([...scenarios]).toEqual(
      report.routes[0]!.scenarios.map((item) => item.id),
    );
    expect([...routes]).toEqual(['/large-route', '/skipped-route']);

    const limitations: string[] = [];
    let notePages = 0;
    while (true) {
      notePages++;
      expect(new URL(page.url()).searchParams.get('token')).toBe(token);
      expect(new URL(page.url()).searchParams.get('page')).toBe('8');
      limitations.push(
        ...(await page.locator('.limitation-list > li').allTextContents()),
      );
      expect(
        await page.locator('.limitation-list > li').count(),
      ).toBeLessThanOrEqual(10);
      const next = page.getByRole('link', {
        name: 'Volgende beperkingen',
        exact: true,
      });
      if (!(await next.count())) break;
      await next.click();
    }
    expect(notePages).toBe(3);
    expect(limitations).toEqual(report.limitations);
    const previousDetails = page.getByRole('link', {
      name: 'Vorige details',
      exact: true,
    });
    expect(
      new URL(
        (await previousDetails.getAttribute('href'))!,
        baseURL,
      ).searchParams.get('notes'),
    ).toBe('3');

    for (const format of ['JSON', 'HTML']) {
      const href = await page
        .getByRole('link', { name: `Download rapport als ${format}` })
        .getAttribute('href');
      const url = new URL(href!, baseURL);
      expect(url.searchParams.get('token')).toBe(token);
      expect(url.searchParams.has('page')).toBe(false);
      expect(url.searchParams.has('notes')).toBe(false);
      const download = await guest.request.get(url.href);
      expect(download.status()).toBe(200);
      if (format === 'JSON') expect(await download.json()).toEqual(report);
      else {
        const html = await download.text();
        for (const finding of scenario.findings)
          expect(html).toContain(finding.message);
        for (const limitation of report.limitations)
          expect(html).toContain(limitation);
        expect(html).not.toContain('<script');
      }
    }
    expect(scripts).toEqual([]);
    const inaccessible = `/reports/${publication.id}?page=999`;
    expect((await page.goto(inaccessible))?.status()).toBe(404);
    expect(
      (
        await page.goto(`${inaccessible}&token=${encodeURIComponent(token)}`)
      )?.status(),
    ).toBe(400);
    const recovery = page.getByRole('link', { name: 'Eerste rapportpagina' });
    expect(
      new URL((await recovery.getAttribute('href'))!, baseURL).searchParams.get(
        'token',
      ),
    ).toBe(token);
    await recovery.click();
    await expect(page.locator('.detail-paging').first()).toContainText(
      'Detailpagina 1 van 8',
    );
  } finally {
    await guest.close();
  }
});
