import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../../apps/chrome-extension/src/model';

import {
  assertLease,
  enqueueRoutes,
  mergePreviouslyMeasuredRoute,
  nextTask,
  registerReachedRoute,
} from '../../apps/chrome-extension/src/runner-policy';

import { navigateDiscoveredRoute } from '../../apps/chrome-extension/src/navigation';

import { job } from './runner.fixture';
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
});
