import { expect, test } from '@playwright/test';

import { diagnosticPublicationFixture } from './diagnostic-publication.fixture';
import { createAccount, openReportDetails } from './diagnostics.fixture';
test.describe('diagnostics', () => {
  test('diagnostics are omitted by default and explicit publication opt-in survives transport and downloads', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    test.setTimeout(60000);
    await createAccount(context, baseURL!);
    const guest = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
    });
    const localInspectionToken = '11223344-5566-4788-9911-aabbccddeeff';
    const scannerBuildSha256 = '0123456789abcdef'.repeat(4);
    try {
      const guestPage = await guest.newPage();
      for (const includeDiagnostics of [false, true]) {
        const { report, originalFinding } = diagnosticPublicationFixture(
          scannerBuildSha256,
          localInspectionToken,
        );
        // Expected public data is independent of the production copying helper.
        // Receipt, DOM-read and video-presentation clocks deliberately differ.
        const expectedTimeline = structuredClone(
          originalFinding.sourceTimeline,
        );
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
        await page
          .getByLabel('Wie mag het rapport zien?')
          .selectOption('PUBLIC');
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
        expect(JSON.stringify(publicationBody)).not.toContain(
          'inspectionToken',
        );
        // Build identity is report provenance, independent of diagnosis consent.
        expect(transportedReport.scannerBuildSha256).toBe(scannerBuildSha256);
        expect(transportedReport.routes[0].coverage[0].outcome).toBe(
          'UNREACHED',
        );
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
          const download = await guest.request.get(
            new URL(href!, baseURL).href,
          );
          expect(download.status()).toBe(200);
          if (format === 'JSON') {
            expect(await download.json()).toEqual(transportedReport);
          } else {
            const html = await download.text();
            expect(html.includes('Technische diagnose bekijken')).toBe(
              includeDiagnostics,
            );
            expect(html.includes('Statisch meetspoor:')).toBe(
              includeDiagnostics,
            );
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
});
