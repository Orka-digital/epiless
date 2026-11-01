import { describe, expect, it } from 'vitest';

import {
  computeCompletion,
  enqueueRoutes,
  nextScrollPosition,
  observationRouteChanged,
} from '../../apps/chrome-extension/src/runner-policy';

import { navigateDiscoveredRoute } from '../../apps/chrome-extension/src/navigation';

import { job } from './runner.fixture';
describe('autonomous runner boundaries', () => {
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
