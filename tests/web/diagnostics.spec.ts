import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { exampleReport } from '../../apps/web/src/lib/example-report';

async function openReportDetails(page: Page) {
  // Document order opens outer route disclosures before nested measurement,
  // diagnosis, sample and source-limit disclosures. No page script is required.
  const disclosures = page.locator('main details');
  for (let index = 0; index < (await disclosures.count()); index++) {
    const disclosure = disclosures.nth(index);
    if ((await disclosure.getAttribute('open')) === null)
      await disclosure.locator(':scope > summary').click();
    await expect(disclosure).toHaveAttribute('open', '');
  }
}

async function createAccount(context: BrowserContext, origin: string) {
  const network = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
  await context.setExtraHTTPHeaders({
    'CF-Connecting-IP': network,
    'X-Forwarded-For': network,
  });
  const challengeResponse = await context.request.post(
    '/api/security/challenge',
    {
      headers: { Origin: origin },
      data: { action: 'auth' },
    },
  );
  expect(challengeResponse.ok(), await challengeResponse.text()).toBe(true);
  const challenge = await challengeResponse.json();
  const signup = await context.request.post('/api/auth/sign-up/email', {
    headers: {
      Origin: origin,
      'x-flashguard-challenge': challenge.id,
      'x-captcha-response': 'flashguard-local-test',
    },
    data: {
      name: 'Diagnostic Test Contributor',
      email: `diagnostic-${crypto.randomUUID()}@example.net`,
      password: 'Diagnostic-test-account-2026!',
    },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
}

test('numeric diagnostics remain static, accessible and readable at 320px without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = await context.newPage();
    const scripts: string[] = [];
    const policyErrors: string[] = [];
    page.on('console', (message) => {
      if (/violates.*Content Security Policy/i.test(message.text()))
        policyErrors.push(message.text());
    });
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(request.url());
    });
    expect((await page.goto('/voorbeeld'))?.status()).toBe(200);
    await expect(page.locator('astro-island, script[src]')).toHaveCount(0);
    await openReportDetails(page);

    const diagnostic = page.locator('.finding-diagnostics').first();
    await expect(diagnostic).toBeVisible();
    await expect(
      diagnostic.getByRole('img', {
        name: 'Statisch meetspoor: relatieve luminantie en aandeel rood, beide van nul tot één',
      }),
    ).toBeVisible();
    await expect(
      diagnostic.getByRole('img', {
        name: 'Schematische kandidaatregio in het analyseframe; de stip is de meetpixel',
      }),
    ).toBeVisible();
    await expect(diagnostic.locator('svg path')).not.toHaveCount(0);
    await expect(
      diagnostic.locator(
        'svg animate, svg animateTransform, svg set, video, canvas, iframe, script',
      ),
    ).toHaveCount(0);
    await expect(diagnostic).toContainText('7 kwalificerende overgangen');
    await expect(diagnostic).toContainText('8 echte pixelsamples');
    await expect(diagnostic).toContainText(
      'geen bewezen oorzaak van de gemeten flits',
    );
    await expect(
      diagnostic.getByRole('heading', {
        name: 'Mogelijke elementen op deze locatie',
      }),
    ).toBeVisible();
    await expect(diagnostic.locator('code')).toHaveText(
      '*:nth-child(1) > *:nth-child(2) > *:nth-child(1)',
    );
    const samples = diagnostic.getByRole('table', {
      name: 'Analysepixel: tijd in ms en sRGB-kanalen van 0 tot 255',
    });
    await expect(samples).toBeVisible();
    await expect(samples.locator('tbody tr')).toHaveCount(8);
    await expect(samples.locator('tbody tr').first().locator('td')).toHaveText([
      '2000.00',
      '0',
      '0',
      '0',
    ]);
    await expect(samples.locator('tbody tr').last().locator('td')).toHaveText([
      '2875.00',
      '255',
      '255',
      '255',
    ]);

    await mkdir('artifacts', { recursive: true });
    await page.screenshot({
      path: 'artifacts/diagnostics-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expect(samples).toBeVisible();
    await expect(diagnostic.locator('code')).toBeVisible();
    await page.screenshot({
      path: 'artifacts/diagnostics-mobile.png',
      fullPage: true,
    });
    expect(scripts).toEqual([]);
    expect(policyErrors).toEqual([]);
    // Axe needs JavaScript timers to finish its injected audit. The original
    // context above independently proves all report interactions without JS.
    const auditContext = await browser.newContext({
      baseURL,
      viewport: { width: 320, height: 844 },
      reducedMotion: 'reduce',
    });
    try {
      const auditPage = await auditContext.newPage();
      await auditPage.goto('/voorbeeld');
      await openReportDetails(auditPage);
      const accessibility = await new AxeBuilder({ page: auditPage })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
    } finally {
      await auditContext.close();
    }
  } finally {
    await context.close();
  }
});

test('diagnostics are omitted by default and explicit publication opt-in survives transport and downloads', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(60000);
  await createAccount(context, baseURL!);
  const guest = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const localInspectionToken = '11223344-5566-4788-9911-aabbccddeeff';
  const scannerBuildSha256 = '0123456789abcdef'.repeat(4);
  try {
    const guestPage = await guest.newPage();
    for (const includeDiagnostics of [false, true]) {
      const report = structuredClone(exampleReport);
      report.id = `diagnostic-${crypto.randomUUID()}`;
      report.origin = `https://diagnostic-${crypto.randomUUID()}.example.net`;
      report.scannerBuildSha256 = scannerBuildSha256;
      report.routes[0]!.url = `${report.origin}/animation`;
      const originalFinding = report.routes[0]!.scenarios[0]!.findings[0]!;
      const quality = report.routes[0]!.scenarios[0]!.quality;
      quality.spatial = {
        mode: 'NATIVE_PIXELS',
        sourceWidth: quality.width,
        sourceHeight: quality.height,
        retainedResolutionRatio: 1,
        stateBytes: 100000,
        stateBudgetBytes: 256 * 1024 * 1024,
        tileSharing: 'LOSSLESS_IDENTICAL_HISTORY',
        colorAssumption: 'SDR_SRGB_8BIT',
      };
      quality.processing = {
        measuredFrames: quality.frameCount,
        meanMs: 6,
        maxMs: 20,
        framesOver16_7Ms: 1,
        scope: 'WORKER_CONVERSION_AND_ANALYSIS',
        conversionMeanMs: 2,
        analysisMeanMs: 4,
      };
      report.routes[0]!.coverage = [
        {
          id: 'compact-coverage',
          scenario: 'compact',
          outcome: 'UNREACHED',
          viewportMethod: 'CDP',
          reason: 'CSS viewport did not change',
          viewport: { width: 600, height: 400, dpr: 2 },
        },
      ];
      const at = Date.parse(report.startedAt) + 2000;
      originalFinding.sourceTimeline = {
        version: 1,
        status: 'CORRELATED',
        clockBasis: 'FRAME_RECEIPT_ESTIMATE',
        windowStartEpochMs: at,
        windowEndEpochMs: at + 500,
        alignmentUncertaintyMs: null,
        frameClock: {
          method: 'PER_FRAME_RECEIPT',
          matchedFrames: 32,
          receiptOffsetSpreadMs: 13.75,
          startBoundaryErrorMs: 2.5,
          endBoundaryErrorMs: 3.25,
        },
        sampledAt: report.endedAt,
        sampleIntervalMs: 100,
        maxSampleGapMs: 100,
        sampleCount: 2,
        firstSampleEpochMs: at,
        lastSampleEpochMs: at + 100,
        complete: false,
        candidates: [
          {
            id: 'node-1',
            inspectionToken: localInspectionToken,
            selectorPath: ['*:nth-child(1)'],
            tag: 'video',
            media: 'VIDEO',
            observations: [
              {
                atEpochMs: at,
                readWindow: {
                  startEpochMs: at - 4,
                  endEpochMs: at - 1,
                  trigger: 'ANIMATION_FRAME',
                  renderEpochMs: at - 6,
                },
                rect: { x: 10, y: 10, width: 100, height: 50 },
                viewport: {
                  width: 640,
                  height: 360,
                  dpr: 1,
                  scrollX: 0,
                  scrollY: 0,
                },
                mutationsSincePrevious: 0,
                animations: [],
                mediaTimeMs: 3200,
                mediaPaused: false,
                videoPresentation: {
                  callbackEpochMs: at - 8,
                  presentationEpochMs: at - 12,
                  expectedDisplayEpochMs: at + 4,
                  mediaTimeMs: 3191.25,
                  presentedFrames: 96,
                },
              },
              {
                atEpochMs: at + 100,
                readWindow: {
                  startEpochMs: at + 96,
                  endEpochMs: at + 99,
                  trigger: 'TIMER_FALLBACK',
                },
                rect: { x: 12, y: 10, width: 100, height: 50 },
                viewport: {
                  width: 640,
                  height: 360,
                  dpr: 1,
                  scrollX: 0,
                  scrollY: 0,
                },
                mutationsSincePrevious: 1,
                animations: [],
                mediaTimeMs: 3300,
                mediaPaused: false,
                videoPresentation: {
                  callbackEpochMs: at + 90,
                  presentationEpochMs: at + 86,
                  expectedDisplayEpochMs: at + 102,
                  mediaTimeMs: 3275.5,
                  presentedFrames: 98,
                },
              },
            ],
          },
        ],
        limitations: [
          'DOM_TIMELINE_SAMPLE_GAP',
          'TEMPORAL_SPATIAL_CORRELATION_NOT_VERIFIED_CAUSE',
        ],
      };
      // Expected public data is independent of the production copying helper.
      // Receipt, DOM-read and video-presentation clocks deliberately differ.
      const expectedTimeline = structuredClone(originalFinding.sourceTimeline);
      delete expectedTimeline.candidates[0]!.inspectionToken;
      await page.goto('/publish');
      const input = page.getByLabel('Kies een lokale JSON-export');
      await expect(input).toBeEnabled();
      await input.setInputFiles({
        name: 'diagnostic-audit.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(report)),
      });
      await expect(
        page.getByRole('heading', {
          name: new URL(report.origin).hostname,
          level: 2,
        }),
      ).toBeVisible();
      const optIn = page.getByRole('checkbox', {
        name: 'Technische diagnose opnemen (pixelsamples en elementaanwijzingen)',
        exact: true,
      });
      await expect(optIn).not.toBeChecked();
      if (includeDiagnostics) await optIn.check();
      await page.getByLabel('Wie mag het rapport zien?').selectOption('PUBLIC');
      await page.getByLabel('Ik heb de geselecteerde inhoud').check();
      const submitted = page.waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/api/publications/intents',
      );
      await page
        .getByRole('button', { name: 'Rapport online bewaren' })
        .click();
      const publicationBody = (await submitted).postDataJSON();
      const transportedReport = publicationBody.report;
      const transportedFinding =
        transportedReport.routes[0].scenarios[0].findings[0];
      if (includeDiagnostics) {
        expect(transportedFinding.diagnostic).toEqual(
          originalFinding.diagnostic,
        );
        expect(transportedFinding.source).toEqual(originalFinding.source);
        expect(transportedFinding.sourceTimeline).toEqual(expectedTimeline);
      } else {
        expect(transportedFinding).not.toHaveProperty('diagnostic');
        expect(transportedFinding).not.toHaveProperty('source');
        expect(transportedFinding).not.toHaveProperty('sourceTimeline');
      }
      expect(JSON.stringify(publicationBody)).not.toContain(
        localInspectionToken,
      );
      expect(JSON.stringify(publicationBody)).not.toContain('inspectionToken');
      // Build identity is report provenance, independent of diagnosis consent.
      expect(transportedReport.scannerBuildSha256).toBe(scannerBuildSha256);
      expect(transportedReport.routes[0].coverage[0].outcome).toBe('UNREACHED');
      await expect(
        page.getByRole('heading', {
          name: 'Je rapport staat online.',
        }),
      ).toBeVisible();
      const shareUrl = await page
        .getByRole('link', {
          name: 'Open het rapport',
        })
        .getAttribute('href');
      expect((await guestPage.goto(shareUrl!))?.status()).toBe(200);
      await openReportDetails(guestPage);
      await expect(
        guestPage.getByText('Verwerking gemiddeld 6.0 ms per frame;', {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        guestPage.getByText('Toestand niet bereikt', { exact: false }),
      ).toBeVisible();
      await expect(
        guestPage.getByText('Schermformaat via browseremulatie', {
          exact: false,
        }),
      ).toBeVisible();
      await expect(guestPage.locator('.finding-diagnostics')).toHaveCount(
        includeDiagnostics ? 1 : 0,
      );
      const guestHtml = await guestPage.content();
      expect(guestHtml).not.toContain(localInspectionToken);
      expect(guestHtml).not.toContain('inspectionToken');
      if (includeDiagnostics) {
        await openReportDetails(guestPage);
        await expect(
          guestPage.locator('.finding-diagnostics').getByRole('table', {
            name: 'Analysepixel: tijd in ms en sRGB-kanalen van 0 tot 255',
          }),
        ).toBeVisible();
        const diagnostic = guestPage.locator('.finding-diagnostics');
        await expect(diagnostic).toContainText(
          'Venstergrenzen gekoppeld aan werkelijk ontvangen frames (32 klokmetingen)',
        );
        await expect(diagnostic).toContainText(
          'De gemeten ontvangstoffset varieert 13.75 ms',
        );
        await expect(diagnostic).toContainText(
          'afwijking tot het gevraagde bronframe: 2.50 / 3.25 ms',
        );
        await expect(diagnostic).toContainText(
          'Deze variatie is geen bovengrens voor capturelatentie',
        );
        await expect(diagnostic).toContainText(
          'de vertraging van capture en compositor is onbekend',
        );
        await expect(diagnostic).toContainText(
          'DOM en videoframes zijn niet atomair gemeten',
        );
        const observations = diagnostic
          .getByRole('region', {
            name: 'DOM-metingen tijdens het detectievenster',
          })
          .getByRole('table');
        await expect(observations.locator('tbody tr')).toHaveCount(2);
        await expect(observations.locator('tbody tr').first()).toContainText(
          'DOM gelezen -4.00–-1.00 ms (ANIMATION_FRAME)',
        );
        await expect(observations.locator('tbody tr').first()).toContainText(
          'Laatste presentatiemelding: 3.19 s · 8.00 ms oud',
        );
        await expect(observations.locator('tbody tr').last()).toContainText(
          'DOM gelezen 96.00–99.00 ms (TIMER_FALLBACK)',
        );
        await expect(observations.locator('tbody tr').last()).toContainText(
          'Laatste presentatiemelding: 3.28 s · 10.00 ms oud',
        );
        await expect(
          diagnostic.locator('video, canvas, iframe, script, svg animate'),
        ).toHaveCount(0);
      }
      for (const format of ['JSON', 'HTML']) {
        const href = await guestPage
          .getByRole('link', {
            name: `Download rapport als ${format}`,
          })
          .getAttribute('href');
        const download = await guest.request.get(new URL(href!, baseURL).href);
        expect(download.status()).toBe(200);
        if (format === 'JSON') {
          expect(await download.json()).toEqual(transportedReport);
        } else {
          const html = await download.text();
          expect(html.includes('Technische diagnose bekijken')).toBe(
            includeDiagnostics,
          );
          expect(html.includes('Statisch meetspoor:')).toBe(includeDiagnostics);
          expect(html.includes('nth-child(2)')).toBe(includeDiagnostics);
          expect(html.includes('32 klokmetingen')).toBe(includeDiagnostics);
          expect(html.includes('ANIMATION_FRAME')).toBe(includeDiagnostics);
          expect(html.includes('TIMER_FALLBACK')).toBe(includeDiagnostics);
          expect(html.includes('Laatste presentatiemelding:')).toBe(
            includeDiagnostics,
          );
          expect(html.includes('geen bovengrens voor capturelatentie')).toBe(
            includeDiagnostics,
          );
          expect(html).not.toContain(localInspectionToken);
          expect(html).not.toContain('inspectionToken');
          expect(html).not.toContain('<script');
        }
      }
    }
  } finally {
    await guest.close();
  }
});
