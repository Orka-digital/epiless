import { describe, expect, it } from 'vitest';

import { DEFAULT_HISTORY_SETTINGS } from '../../apps/chrome-extension/src/model';

import {
  buildHistoryExport,
  buildHtmlReport,
  prepareExportJobs,
} from '../../apps/chrome-extension/src/export';

import { exampleReport } from '../../apps/web/src/lib/example-report';
import { fixture } from './p0.fixture';
describe('standalone exports', () => {
  it('preserves schema, full site history, real measurements and aggregate statistics', () => {
    const job = fixture();
    const output = buildHistoryExport(
      [job, fixture('second')],
      DEFAULT_HISTORY_SETTINGS,
      'SITE',
    );
    expect(output.schemaVersion).toBe(1);
    expect(output.audits).toHaveLength(2);
    expect(output.sites[0]).toMatchObject({
      attempts: 2,
      uniqueCandidates: 1,
      occurrences: 2,
    });
    expect(output.audits[0].report.passed).toBeNull();
    expect(output.audits[0].report.engineVersion).toBe('heuristic-test');
    expect(output.audits[0].mode).toBe('EXTENDED');
  });

  it('pseudonymizes URLs and diagnostics consistently without leaking grouping keys or mutating the source', () => {
    const job = fixture();
    job.tasks[0].reasons = ['secret account client@example.test'];
    job.disposableSource = {
      nonce: 'private-scan-ownership',
      originalTabId: 123,
      originalUrl: 'https://example.test/private-original',
      closed: true,
      cleanupStatus: 'CLOSED',
    };
    job.tasks[0].navigationSource = 'https://example.test/source';
    job.tasks[0].aliases = ['https://example.test/alias'];
    job.tasks[0].observations[0].mediaEvidence = {
      version: 1,
      complete: false,
      reasons: ['MEDIA_OBSERVATION_UNAVAILABLE'],
      items: [],
    };
    const finding = job.tasks[0].observations[0].measurement!.findings[0];
    finding.diagnostic = structuredClone(
      exampleReport.routes[0]!.scenarios[0]!.findings[0]!.diagnostic,
    );
    finding.source = structuredClone(
      exampleReport.routes[0]!.scenarios[0]!.findings[0]!.source,
    );
    const output = buildHistoryExport(
      [job, fixture('repeat')],
      DEFAULT_HISTORY_SETTINGS,
      'ALL',
      true,
    );
    expect(JSON.stringify(output)).not.toContain('private-client');
    expect(JSON.stringify(output)).not.toContain('example.test');
    expect(JSON.stringify(output)).not.toContain('client@');
    expect(
      output.audits[0].report.routes[0].scenarios[0].findings[0].source,
    ).toBeUndefined();
    expect(
      output.audits[0].report.routes[0].scenarios[0].findings[0].diagnostic,
    ).toBeUndefined();
    expect(finding.diagnostic).toBeDefined();
    expect(output.sites[0].uniqueCandidates).toBe(1);
    expect(output.sites[0].occurrences).toBe(2);
    expect(prepareExportJobs([job], true)[0].origin).toBe(
      'https://site-1.invalid',
    );
    expect(JSON.stringify(prepareExportJobs([job], true))).not.toContain(
      'example.test',
    );
    expect(job.origin).toBe('https://example.test');
    expect(prepareExportJobs([job], true)[0].disposableSource).toBeUndefined();
    expect(job.disposableSource.nonce).toBe('private-scan-ownership');
    expect(
      prepareExportJobs([job], true)[0].tasks[0].observations[0].mediaEvidence,
    ).toBeUndefined();
    expect(job.tasks[0].observations[0].mediaEvidence).toBeDefined();
    expect(
      job.tasks[0].observations[0].measurement!.findings[0].message,
    ).toContain('private-client');
  });

  it('escapes malicious finding text and includes offline printable timelines, quality and limitations', () => {
    const job = fixture();
    job.tasks[0].observations[0].measurement!.findings[0].message =
      '<script>alert(1)</script><img src="https://attacker.test" onerror="alert(2)">';
    job.limitations = ['<a href="javascript:alert(3)">unsafe</a>'];
    const html = buildHtmlReport(job);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('@media print');
    expect(html).toContain('<caption>');
    expect(html).toContain('1.00 s–2.00 s');
    expect(html).toContain('60.0 fps');
    expect(html).toContain('WCAG 2.3.1');
    expect(html).toContain(
      'Regio in analysepixels: x 10, y 10, breedte 20, hoogte 20',
    );
    expect(html).toContain('geen normatieve oppervlaktemeting');
    expect(html).toContain('NEEDS_REVIEW');
  });
});
