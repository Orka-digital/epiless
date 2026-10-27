import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { exampleReport } from '../../apps/web/src/lib/example-report';

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
  const guest = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const guestPage = await guest.newPage();
  const urls: Record<string, string> = {};
  for (const visibility of ['PRIVATE', 'UNLISTED', 'PUBLIC']) {
    await page.goto('/publish');
    await expect(page.getByLabel('Kies een lokale JSON-export')).toBeEnabled();
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
    await page.getByLabel('Wie mag het rapport zien?').selectOption(visibility);
    await expect(
      page.getByRole('button', { name: 'Rapport online bewaren' }),
    ).toBeDisabled();
    await page.getByLabel('Ik heb de geselecteerde inhoud').check();
    await page.getByRole('button', { name: 'Rapport online bewaren' }).click();
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
        await guestPage.locator('meta[name="robots"]').getAttribute('content'),
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

test('production first-render requests fit budgets including inline island bootstrap', async ({
  browser,
  baseURL,
}, testInfo) => {
  const measurements: Record<string, unknown>[] = [];
  for (const route of ['/', '/sites', '/voorbeeld', '/account', '/publish']) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const responses: { type: string; bytes: Buffer; url: string }[] = [];
    const pending: Promise<void>[] = [];
    page.on('response', (response) => {
      pending.push(
        (async () => {
          const type = response.request().resourceType();
          if (
            !['script', 'stylesheet', 'font', 'document', 'image'].includes(
              type,
            ) ||
            (response.status() >= 300 && response.status() < 400)
          )
            return;
          responses.push({
            type,
            bytes: await response.body(),
            url: response.url(),
          });
        })(),
      );
    });
    await page.goto(route);
    if (route === '/account')
      await expect(
        page.getByRole('button', { name: 'Aanmelden', exact: true }).last(),
      ).toBeEnabled();
    if (route === '/publish')
      await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await Promise.all(pending);
    const inline = await page
      .locator('script:not([src])')
      .evaluateAll((elements) =>
        elements
          .filter((e) => !e.getAttribute('type')?.includes('json'))
          .map((e) => e.textContent || ''),
      );
    const js =
      responses
        .filter((r) => r.type === 'script')
        .reduce((sum, r) => sum + gzipSync(r.bytes).length, 0) +
      inline
        .filter(Boolean)
        .reduce((sum, text) => sum + gzipSync(text).length, 0);
    const css = responses
      .filter((r) => r.type === 'stylesheet')
      .reduce((sum, r) => sum + gzipSync(r.bytes).length, 0);
    const fonts = responses
      .filter((r) => r.type === 'font')
      .reduce((sum, r) => sum + r.bytes.length, 0);
    const total = responses.reduce(
      (sum, r) =>
        sum + (r.type === 'font' ? r.bytes.length : gzipSync(r.bytes).length),
      0,
    );
    expect(js, `${route} JS`).toBeLessThanOrEqual(
      (['/account', '/publish'].includes(route) ? 100 : 5) * 1024,
    );
    expect(css).toBeLessThanOrEqual(30 * 1024);
    expect(fonts).toBeLessThanOrEqual(100 * 1024);
    expect(responses.filter((r) => r.type === 'font')).toHaveLength(0);
    expect(total).toBeLessThanOrEqual(450 * 1024);
    expect(
      responses.some((r) => r.url.includes('challenges.cloudflare.com')),
    ).toBe(false);
    measurements.push({ route, js, css, fonts, total });
    await context.close();
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/first-render-budgets.json',
    JSON.stringify(measurements, null, 2),
  );
  await testInfo.attach('first-render-budgets.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
});

test('fixed mobile lab: median of three cold LCP and CLS runs', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90000);
  const measurements: {
    route: string;
    runs: { lcp: number; cls: number }[];
    medianLcp: number;
    medianCls: number;
  }[] = [];
  for (const route of ['/', '/sites', '/voorbeeld']) {
    const runs: { lcp: number; cls: number }[] = [];
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 1_600_000 / 8,
        uploadThroughput: 750_000 / 8,
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.addInitScript(() => {
        const values = { lcp: 0, cls: 0 };
        (window as Window & { lab: typeof values }).lab = values;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) values.lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              hadRecentInput: boolean;
              value: number;
            };
            if (!shift.hadRecentInput) values.cls += shift.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      expect((await page.goto(route))?.status()).toBe(200);
      await page.evaluate(() => document.fonts.ready);
      // A fixed observation window after fonts settle, not a user-interaction wait.
      await page.waitForTimeout(1500);
      runs.push(
        await page.evaluate(
          () => (window as Window & { lab: { lcp: number; cls: number } }).lab,
        ),
      );
      await context.close();
    }
    const medianLcp = runs.map((run) => run.lcp).sort((a, b) => a - b)[1];
    const medianCls = runs.map((run) => run.cls).sort((a, b) => a - b)[1];
    measurements.push({ route, runs, medianLcp, medianCls });
    expect(medianLcp).toBeGreaterThan(0);
    expect(medianLcp, `${route} median LCP`).toBeLessThanOrEqual(2500);
    expect(medianCls, `${route} median CLS`).toBeLessThanOrEqual(0.1);
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/mobile-lab.json',
    JSON.stringify(
      {
        profile:
          '390x844 DPR1; 4x CPU; 150ms RTT; 1.6 Mbps down; 750 Kbps up; cold cache; three runs',
        measurements,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('mobile-lab.json', {
    body: JSON.stringify(
      {
        profile:
          '390x844 DPR1; 4x CPU; 150ms RTT; 1.6 Mbps down; 750 Kbps up; cold cache; three runs',
        measurements,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
