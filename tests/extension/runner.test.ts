import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LIMITS,
  type ScanJob,
} from '../../apps/chrome-extension/src/model';
import {
  assertLease,
  computeCompletion,
  enqueueRoutes,
  nextTask,
  trustedTransferSender,
  registerReachedRoute,
  observationRouteChanged,
  nextScrollPosition,
  mergePreviouslyMeasuredRoute,
} from '../../apps/chrome-extension/src/runner-policy';
import { navigateDiscoveredRoute } from '../../apps/chrome-extension/src/navigation';
import { buildReport } from '../../apps/chrome-extension/src/report';

function job(): ScanJob {
  return {
    id: 'scan-one',
    tabId: 1,
    origin: 'https://example.test',
    startUrl: 'https://example.test/',
    startedAt: '2026-10-26T12:00:00Z',
    updatedAt: '2026-10-26T12:00:00Z',
    state: 'RUNNING',
    stopIntent: false,
    generation: 'lease-one',
    elapsedMs: 0,
    mode: 'AUTONOMOUS',
    skippedLinks: 0,
    limitations: [],
    limits: { ...DEFAULT_LIMITS },
    tasks: [
      {
        id: 'home',
        url: 'https://example.test/',
        depth: 0,
        state: 'QUEUED',
        observations: [],
        reasons: [],
      },
    ],
  };
}
describe('autonomous runner boundaries', () => {
  it('cannot schedule or execute an action after a persisted stop intent', () => {
    const scan = job();
    expect(nextTask(scan)?.id).toBe('home');
    scan.stopIntent = true;
    expect(nextTask(scan)).toBeUndefined();
    expect(() => assertLease(scan, 'lease-one')).toThrow('RUNNER_CANCELLED');
  });
  it('rejects stale worker generations and paused jobs before browser actions', () => {
    const scan = job();
    expect(() => assertLease(scan, 'old-worker')).toThrow('RUNNER_CANCELLED');
    scan.state = 'PAUSED';
    expect(() => assertLease(scan, scan.generation)).toThrow(
      'RUNNER_CANCELLED',
    );
  });
  it('does not schedule after the time budget', () => {
    const scan = job();
    scan.elapsedMs = DEFAULT_LIMITS.maxDurationMs;
    expect(nextTask(scan)).toBeUndefined();
  });
  it('deduplicates discovered routes and excludes other origins, secrets and transactions', () => {
    const scan = job();
    enqueueRoutes(
      scan,
      [
        '/about',
        '/about#team',
        '/logout',
        '/delete/123',
        '/info?token=private',
        'https://other.test/',
      ],
      scan.tasks[0],
    );
    expect(scan.tasks.map((task) => task.url)).toEqual([
      'https://example.test/',
      'https://example.test/about',
    ]);
    expect(scan.skippedLinks).toBe(4);
  });
  it('records a safe reached redirect, deduplicates its queued alias, and rejects unsafe destinations without persisting secrets', () => {
    const scan = job();
    enqueueRoutes(scan, ['/reached', '/next'], scan.tasks[0]);
    expect(
      registerReachedRoute(scan, 'home', 'https://example.test/reached#team'),
    ).toBe('https://example.test/reached');
    expect(scan.tasks.map((task) => task.url)).toEqual([
      'https://example.test/reached',
      'https://example.test/next',
    ]);
    expect(scan.tasks[0].reasons.join()).toContain('Same-origin redirect');
    for (const actual of [
      'https://elsewhere.test/',
      'https://example.test/logout',
      'https://example.test/reached?token=private',
      'https://example.test/#/private',
    ])
      expect(() => registerReachedRoute(scan, 'home', actual)).toThrow();
    expect(JSON.stringify(scan)).not.toContain('private');
  });
  it('retains discovery provenance when rendered SPA links follow sitemap candidates', () => {
    const scan = job();
    enqueueRoutes(scan, ['/sitemap-only', '/client-only'], scan.tasks[0]);
    expect(scan.tasks[2].navigationSource).toBeUndefined();
    enqueueRoutes(scan, ['/client-only'], scan.tasks[0], true, 900);
    expect(scan.tasks[2].navigationSource).toBe('https://example.test/');
    expect(scan.tasks[2].navigationScrollY).toBe(900);
    expect(scan.tasks.map((task) => task.url)).toEqual([
      'https://example.test/',
      'https://example.test/sitemap-only',
      'https://example.test/client-only',
    ]);
  });
  it('bounds persisted discovery scroll context and keeps the first observed source state', () => {
    const scan = job();
    enqueueRoutes(scan, ['/lazy'], scan.tasks[0], true, 100000);
    expect(scan.tasks[1].navigationScrollY).toBe(50000);
    enqueueRoutes(scan, ['/lazy'], scan.tasks[0], true, 0);
    expect(scan.tasks[1].navigationScrollY).toBe(50000);
    enqueueRoutes(scan, ['/other'], scan.tasks[0], true, Number.NaN);
    expect(scan.tasks[2].navigationScrollY).toBe(0);
  });
  it('retains redirect aliases across later inventories and merges an already measured destination', () => {
    const scan = job();
    enqueueRoutes(scan, ['/redirect', '/redirect-again'], scan.tasks[0], true);
    const first = scan.tasks[1];
    registerReachedRoute(scan, first.id, 'https://example.test/reached');
    first.state = 'OBSERVED';
    first.observations.push({
      id: 'viewport',
      scenario: 'initial-viewport',
      startedAt: scan.startedAt,
      endedAt: scan.startedAt,
      achieved: true,
    });
    enqueueRoutes(
      scan,
      ['/redirect', '/redirect-again', '/reached'],
      scan.tasks[0],
      true,
    );
    expect(scan.tasks).toHaveLength(3);
    const second = scan.tasks[2];
    second.state = 'RUNNING';
    registerReachedRoute(scan, second.id, 'https://example.test/reached');
    second.observations.push({
      id: 'redirect-transition',
      scenario: 'navigation-transition',
      startedAt: scan.startedAt,
      endedAt: scan.startedAt,
      achieved: false,
      reason: 'Insufficient frames',
    });
    expect(mergePreviouslyMeasuredRoute(scan, second.id)).toBe(true);
    expect(scan.tasks).toHaveLength(2);
    expect(first.aliases).toEqual([
      'https://example.test/redirect',
      'https://example.test/redirect-again',
    ]);
    expect(first.observations.map((value) => value.id)).toEqual([
      'viewport',
      'redirect-transition',
    ]);
    expect(first.state).toBe('PARTIAL');
    enqueueRoutes(
      scan,
      ['/redirect', '/redirect-again', '/reached'],
      scan.tasks[0],
      true,
    );
    expect(scan.tasks).toHaveLength(2);
  });
  it('returns to a discovered source and activates its client-only link after an intervening page', async () => {
    let current = 'https://example.test/sitemap-only';
    const documents: string[] = [];
    let revealed = false;
    const target = 'https://example.test/client-only';
    const source = 'https://example.test/';
    const reached = await navigateDiscoveredRoute(target, source, {
      currentUrl: async () => current,
      activateLink: async () => undefined,
      openDocument: async (url, context) => {
        expect(context).toBe('source');
        expect(url).not.toBe(target);
        documents.push(url);
        current = url;
        return url;
      },
      revealAndActivateLink: async (url) => {
        expect(current).toBe(source);
        revealed = true;
        current = url;
        return current;
      },
    });
    expect(reached).toBe(target);
    expect(documents).toEqual([source]);
    expect(revealed).toBe(true);
  });
  it('does not misreport a document 404 when the recorded source link cannot be re-established', async () => {
    const documents: string[] = [];
    await expect(
      navigateDiscoveredRoute(
        'https://example.test/client-only',
        'https://example.test/',
        {
          currentUrl: async () => 'https://example.test/sitemap-only',
          activateLink: async () => undefined,
          openDocument: async (url) => {
            documents.push(url);
            return url;
          },
          revealAndActivateLink: async () => undefined,
        },
      ),
    ).rejects.toThrow('DISCOVERED_NAVIGATION_LINK_UNOBSERVED');
    expect(documents).toEqual(['https://example.test/']);
  });
  it('does not count hash-router links as an observed path route', () => {
    const scan = job();
    enqueueRoutes(scan, ['/#/one', '/#!/two', '/about#team'], scan.tasks[0]);
    expect(scan.tasks.map((task) => task.url)).toEqual([
      'https://example.test/',
      'https://example.test/about',
    ]);
    expect(scan.skippedLinks).toBe(2);
    expect(scan.limitations).toContain('HASH_ROUTER_ROUTES_UNOBSERVED');
  });
  it('detects SPA path/secret/hash transitions while permitting an unchanged hash viewport and ordinary anchors', () => {
    expect(
      observationRouteChanged(
        'https://example.test/#/one',
        'https://example.test/#/one',
      ),
    ).toBe(false);
    expect(
      observationRouteChanged(
        'https://example.test/#/one',
        'https://example.test/#/two',
      ),
    ).toBe(true);
    expect(
      observationRouteChanged(
        'https://example.test/',
        'https://example.test/#team',
      ),
    ).toBe(false);
    for (const destination of [
      '/spa',
      '/?token=private',
      '/#/private',
      'https://other.test/',
    ])
      expect(
        observationRouteChanged(
          'https://example.test/',
          new URL(destination, 'https://example.test/').href,
        ),
      ).toBe(true);
  });
  it('extends scroll exploration after lazy growth but respects the six-step and pixel bounds', () => {
    const page = {
      scrollHeight: 1800,
      viewport: { width: 1000, height: 800, dpr: 1 },
    };
    expect(nextScrollPosition(page, 800, 0)).toBe(600);
    expect(nextScrollPosition(page, 1800, 2)).toBeUndefined();
    page.scrollHeight = 2800;
    expect(nextScrollPosition(page, 1800, 2)).toBe(1600);
    expect(nextScrollPosition(page, 1800, 6)).toBeUndefined();
    page.scrollHeight = 100000;
    expect(nextScrollPosition(page, 51000, 2)).toBeUndefined();
  });
  it('records route and depth limits as limited discovery', () => {
    const scan = job();
    scan.limits.maxRoutes = 2;
    enqueueRoutes(scan, ['/one', '/two', '/three'], scan.tasks[0]);
    expect(scan.tasks).toHaveLength(2);
    expect(scan.limitations).toContain('ROUTE_LIMIT_REACHED');
    scan.tasks[1].depth = 4;
    enqueueRoutes(scan, ['/too-deep'], scan.tasks[1]);
    expect(scan.tasks).toHaveLength(2);
    expect(scan.skippedLinks).toBe(1);
  });
  it('keeps queued, skipped and unusable observations partial', () => {
    const scan = job();
    expect(computeCompletion(scan)).toBe('PARTIAL');
    scan.tasks[0].state = 'OBSERVED';
    expect(computeCompletion(scan)).toBe('COMPLETED');
    scan.limitations.push('SCROLL_LIMIT_REACHED');
    expect(computeCompletion(scan)).toBe('PARTIAL');
  });
});
describe('exported audit integrity', () => {
  it('exports interrupted work without inventing a pass or a measurement', () => {
    const scan = job();
    scan.state = 'INTERRUPTED';
    scan.stopReason = 'CAPTURE_LOST';
    scan.endedAt = '2026-10-26T12:01:00Z';
    const report = buildReport(scan);
    expect(report.status).toBe('INCONCLUSIVE');
    expect(report.passed).toBeNull();
    expect(report.routes[0].status).toBe('SKIPPED');
    expect(report.routes[0].scenarios).toHaveLength(0);
    expect(report.job.visitedRoutes).toBe(0);
  });
  it('strips URL query/fragment/credentials from export while retaining scope', () => {
    const scan = job();
    scan.tasks[0].url =
      'https://secret:password@example.test/account?token=secret#private';
    const report = buildReport(scan);
    expect(report.routes[0].url).toBe('https://example.test/account');
    expect(JSON.stringify(report)).not.toContain('password');
    expect(JSON.stringify(report)).not.toContain('token=');
  });
  it('keeps reliable candidate findings distinct from normative conformance', () => {
    const scan = job();
    scan.state = 'COMPLETED';
    scan.endedAt = '2026-10-26T12:00:15Z';
    scan.tasks[0].state = 'OBSERVED';
    scan.tasks[0].observations.push({
      id: 'segment-one',
      scenario: 'initial',
      startedAt: scan.startedAt,
      endedAt: scan.endedAt,
      achieved: true,
      measurement: {
        status: 'NEEDS_REVIEW',
        passed: null,
        quality: {
          frameCount: 900,
          effectiveFps: 60,
          maxGapMs: 17,
          width: 640,
          height: 360,
          downsampled: true,
          interrupted: false,
        },
        limitations: ['Downsampled pixels.'],
        findings: [
          {
            id: 'candidate-one',
            type: 'GENERAL_FLASH',
            severity: 'warning',
            reviewStatus: 'NEEDS_REVIEW',
            startMs: 0,
            endMs: 1000,
            flashesInWindow: 4,
            affectedRatio: 0.3,
            message: 'Candidate needs review.',
          },
        ],
      },
    });
    const report = buildReport(scan);
    expect(report.status).toBe('INCONCLUSIVE');
    expect(report.passed).toBeNull();
    expect(report.routes[0].scenarios[0].findings).toHaveLength(1);
    expect(report.routes[0].scenarios[0].quality.downsampled).toBe(true);
  });
});
describe('hosted upload handoff', () => {
  it('accepts only the configured exact origin and publish path with a browser tab', () => {
    expect(
      trustedTransferSender(
        { url: 'http://localhost:4321/publish', tab: { id: 5 } },
        'http://localhost:4321',
      ),
    ).toBe(true);
    expect(
      trustedTransferSender(
        { url: 'http://localhost:4322/publish', tab: { id: 5 } },
        'http://localhost:4321',
      ),
    ).toBe(false);
    expect(
      trustedTransferSender(
        { url: 'http://localhost:4321/publish-evil', tab: { id: 5 } },
        'http://localhost:4321',
      ),
    ).toBe(false);
    expect(
      trustedTransferSender(
        { url: 'https://localhost.attacker.test/publish', tab: { id: 5 } },
        'http://localhost:4321',
      ),
    ).toBe(false);
    expect(
      trustedTransferSender(
        { url: 'http://localhost:4321/publish' },
        'http://localhost:4321',
      ),
    ).toBe(false);
  });
});
