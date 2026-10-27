import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HISTORY_SETTINGS,
  DEFAULT_LIMITS,
  viewportDuration,
  canResumeWithVersions,
  RUNNER_VERSION,
  type ScanJob,
} from '../../apps/chrome-extension/src/model';
import {
  candidateSummaries,
  expireJobDetails,
  historySummary,
} from '../../apps/chrome-extension/src/history';
import {
  buildHistoryExport,
  buildHtmlReport,
  prepareExportJobs,
} from '../../apps/chrome-extension/src/export';
import {
  discoverSitemap,
  parseSitemap,
  robotsAllows,
} from '../../apps/chrome-extension/src/sitemap';
import { buildReport } from '../../apps/chrome-extension/src/report';
import { exampleReport } from '../../apps/web/src/lib/example-report';

function fixture(id = 'audit-one'): ScanJob {
  return {
    id,
    tabId: 1,
    origin: 'https://example.test',
    startUrl: 'https://example.test/private-client',
    engineVersion: 'heuristic-test',
    startedAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-01-01T12:00:30Z',
    endedAt: '2026-01-01T12:00:30Z',
    state: 'COMPLETED',
    stopIntent: false,
    generation: 'lease',
    elapsedMs: 30000,
    mode: 'EXTENDED',
    viewportDurationMs: 30000,
    skippedLinks: 0,
    limitations: ['Unvalidated capture.'],
    limits: { ...DEFAULT_LIMITS, maxRoutes: 1 },
    tasks: [
      {
        id: 'route',
        url: 'https://example.test/private-client',
        depth: 0,
        state: 'OBSERVED',
        reasons: [],
        observations: [
          {
            id: 'observation',
            scenario: 'extended-viewport',
            startedAt: '2026-01-01T12:00:00Z',
            endedAt: '2026-01-01T12:00:30Z',
            achieved: true,
            measurement: {
              status: 'NEEDS_REVIEW',
              passed: null,
              limitations: [],
              quality: {
                frameCount: 1800,
                effectiveFps: 60,
                maxGapMs: 17,
                width: 320,
                height: 180,
                downsampled: false,
                interrupted: false,
              },
              findings: [
                {
                  id: 'candidate',
                  type: 'GENERAL_FLASH',
                  severity: 'warning',
                  reviewStatus: 'NEEDS_REVIEW',
                  startMs: 1000,
                  endMs: 2000,
                  flashesInWindow: 4,
                  affectedRatio: 0.2,
                  region: { x: 10, y: 10, width: 20, height: 20 },
                  message: 'Candidate at private-client.',
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('P0 audit modes and local history', () => {
  it('preserves measured versions and refuses to mix old or unknown versions on resume', () => {
    const job = fixture();
    expect(buildReport(job).runnerVersion).toBe('legacy-unrecorded');
    expect(canResumeWithVersions(job, job.engineVersion!)).toBe(false);
    job.runnerVersion = RUNNER_VERSION;
    job.scannerBuildSha256 = 'a'.repeat(64);
    expect(canResumeWithVersions(job, job.engineVersion!, 'a'.repeat(64))).toBe(
      true,
    );
    expect(canResumeWithVersions(job, job.engineVersion!, 'b'.repeat(64))).toBe(
      false,
    );
    expect(canResumeWithVersions(job, job.engineVersion!, undefined)).toBe(
      false,
    );
    expect(canResumeWithVersions(job, 'future-engine')).toBe(false);
    expect(buildReport(job).runnerVersion).toBe(RUNNER_VERSION);
    const old = structuredClone(job);
    old.runnerVersion = '0.1.0';
    expect(canResumeWithVersions(old, job.engineVersion!)).toBe(false);
    expect(buildReport(old).runnerVersion).toBe('0.1.0');
    expect(historySummary([old, job])[0].uniqueCandidates).toBe(2);
  });

  it('uses fixed quick duration and clamps extended defaults and untrusted durations', () => {
    expect(viewportDuration('QUICK', 100)).toBe(15000);
    expect(viewportDuration('EXTENDED')).toBe(30000);
    expect(viewportDuration('EXTENDED', Number.NaN)).toBe(30000);
    expect(viewportDuration('EXTENDED', 2)).toBe(15000);
    expect(viewportDuration('EXTENDED', 300)).toBe(120000);
  });
  it('counts repeat occurrences separately, preserves unobserved candidates and separates contexts', () => {
    const old = fixture();
    const repeated = fixture('repeat');
    const clear = fixture('not-seen');
    clear.tasks[0].observations[0].measurement!.findings = [];
    const summary = historySummary([old, repeated, clear])[0];
    expect(summary.uniqueCandidates).toBe(1);
    expect(summary.occurrences).toBe(2);
    expect(summary.attempts).toBe(3);
    expect(summary.resolvedIssues).toBe(0);
    expect(summary.qualityRatio).toBe(1);
    repeated.engineVersion = 'different-engine';
    expect(historySummary([old, repeated])[0].uniqueCandidates).toBe(2);
    repeated.engineVersion = old.engineVersion;
    repeated.tasks[0].observations[0].measurement!.quality.width = 640;
    expect(historySummary([old, repeated])[0].uniqueCandidates).toBe(2);
  });
  it('expires only event details, preserves compact counts and cannot manufacture a clean report', () => {
    const job = fixture();
    const before = candidateSummaries(job);
    expect(
      expireJobDetails(
        job,
        DEFAULT_HISTORY_SETTINGS,
        Date.parse('2026-10-27T12:00:00Z'),
      ),
    ).toBe(true);
    expect(job.tasks[0].observations[0].measurement!.findings).toEqual([]);
    expect(candidateSummaries(job)).toEqual(before);
    expect(historySummary([job])[0].occurrences).toBe(1);
    expect(buildReport(job).status).toBe('INCONCLUSIVE');
    expect(buildReport(job).limitations.join(' ')).toContain(
      'EVENT_DETAILS_EXPIRED',
    );
    expect(expireJobDetails(job, DEFAULT_HISTORY_SETTINGS, Date.now())).toBe(
      false,
    );
  });
  it('keeps legacy retained and unexpired candidate groups aligned after the version-key upgrade', () => {
    const live = fixture('live');
    const expired = fixture('expired');
    expired.retainedCandidates = candidateSummaries(expired).map(
      (candidate) => {
        const key = JSON.parse(candidate.key);
        key.splice(4, 1); // Historical format had no runner-version position.
        return { ...candidate, key: JSON.stringify(key) };
      },
    );
    const stored = structuredClone(expired.retainedCandidates);
    expect(historySummary([live, expired])[0].uniqueCandidates).toBe(1);
    expect(historySummary([live, expired])[0].occurrences).toBe(2);
    expect(expired.retainedCandidates).toEqual(stored);
  });
  it('never prunes active jobs or data configured to remain', () => {
    const job = fixture();
    job.state = 'RUNNING';
    expect(expireJobDetails(job, DEFAULT_HISTORY_SETTINGS, Date.now())).toBe(
      false,
    );
    job.state = 'COMPLETED';
    expect(
      expireJobDetails(
        job,
        { schemaVersion: 1, detailRetentionDays: null },
        Date.now(),
      ),
    ).toBe(false);
  });
});

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

describe('bounded sitemap discovery', () => {
  it('accepts normal sitemap namespaces and rejects entities and oversized candidate lists', () => {
    expect(
      parseSitemap(
        '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/a</loc></url></urlset>',
      ),
    ).toEqual({ kind: 'urls', urls: ['https://example.test/a'] });
    expect(() =>
      parseSitemap(
        '<!DOCTYPE urlset [<!ENTITY evil SYSTEM "file:///secret">]><urlset></urlset>',
      ),
    ).toThrow('SITEMAP_UNSUPPORTED_XML');
    expect(() =>
      parseSitemap(
        '<urlset>' +
          '<loc>https://example.test/a</loc>'.repeat(501) +
          '</urlset>',
      ),
    ).toThrow('SITEMAP_CANDIDATE_LIMIT');
  });
  it('honors robots exclusions and longest matching allowances', () => {
    const robots =
      'User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /products/*/edit$';
    expect(robotsAllows('https://example.test/private/hidden', robots)).toBe(
      false,
    );
    expect(
      robotsAllows('https://example.test/private/public/info', robots),
    ).toBe(true);
    expect(robotsAllows('https://example.test/products/4/edit', robots)).toBe(
      false,
    );
    expect(
      robotsAllows('https://example.test/products/4/edit/help', robots),
    ).toBe(true);
    expect(
      robotsAllows(
        'https://example.test/private',
        robots + '\nUser-agent: FlashGuard\nAllow: /',
      ),
    ).toBe(true);
  });
  it('cannot bypass robots paths through unreserved percent encoding or Unicode spelling', () => {
    expect(
      robotsAllows(
        'https://example.test/%70rivate/info',
        'User-agent: *\nDisallow: /private',
      ),
    ).toBe(false);
    expect(
      robotsAllows(
        'https://example.test/private/info',
        'User-agent: *\nDisallow: /%70rivate',
      ),
    ).toBe(false);
    expect(
      robotsAllows(
        'https://example.test/caf%C3%A9/menu',
        'User-agent: *\nDisallow: /café',
      ),
    ).toBe(false);
    expect(
      robotsAllows(
        'https://example.test/other',
        'User-agent: *\nDisallow: /\nAllow: /%2A',
      ),
    ).toBe(false);
  });
  it('fetches only safe exact-origin documents without cookies or redirects, excludes transactions and private routes', async () => {
    const documents: Record<string, string> = {
      'https://example.test/robots.txt':
        'User-agent: *\nDisallow: /private\nSitemap: https://example.test/sitemap.xml',
      'https://example.test/sitemap.xml':
        '<sitemapindex><sitemap><loc>https://evil.test/feed.xml</loc></sitemap><sitemap><loc>https://example.test/pages.xml</loc></sitemap></sitemapindex>',
      'https://example.test/pages.xml':
        '<urlset>' +
        [
          '/about',
          '/private',
          '/logout',
          '/info?token=secret',
          'https://other.test/',
        ]
          .map(
            (route) =>
              `<url><loc>${route.startsWith('http') ? route : `https://example.test${route}`}</loc></url>`,
          )
          .join('') +
        '</urlset>',
    };
    const fetcher = vi.fn(
      async (url: string | URL | Request, options?: RequestInit) => {
        expect(options).toMatchObject({
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        expect(String(url)).toMatch(/^https:\/\/example.test\//);
        return new Response(documents[String(url)] ?? '', {
          status: documents[String(url)] ? 200 : 404,
        });
      },
    );
    const guard = vi.fn(async () => undefined);
    expect(
      (await discoverSitemap('https://example.test', guard, fetcher)).urls,
    ).toEqual(['https://example.test/about']);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(guard).toHaveBeenCalled();
  });
  it('stops document traversal and does not bypass unavailable robots checks', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('robots.txt'))
        return new Response('', { status: 404 });
      return new Response(
        '<sitemapindex>' +
          [1, 2, 3, 4]
            .map(
              (n) =>
                `<sitemap><loc>https://example.test/sitemap${n}.xml</loc></sitemap>`,
            )
            .join('') +
          '</sitemapindex>',
      );
    });
    const result = await discoverSitemap(
      'https://example.test',
      async () => undefined,
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(4); // robots + at most three sitemap documents
    expect(result.limitations).toContain('SITEMAP_DOCUMENT_LIMIT');
    const unavailable = vi.fn(async () => new Response('', { status: 403 }));
    expect(
      (
        await discoverSitemap(
          'https://example.test',
          async () => undefined,
          unavailable,
        )
      ).urls,
    ).toEqual([]);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
});
