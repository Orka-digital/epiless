import { describe, expect, it } from 'vitest';
import {
  contentHash,
  stableJson,
  normalizePublicUrl,
  planRoute,
  evaluateAction,
  auditReportSchema,
  validatePublicReport,
} from '../src/index.js';

export function reportFixture() {
  return {
    schemaVersion: 1,
    id: 'fixture-report',
    origin: 'https://example.com',
    startedAt: '2026-10-26T12:00:00Z',
    endedAt: '2026-10-26T12:01:00Z',
    engineVersion: '0.1.0-candidate',
    runnerVersion: '0.1.0',
    status: 'INCONCLUSIVE',
    passed: null,
    job: {
      state: 'PARTIAL',
      stopReason: 'Test capture',
      maxRoutes: 50,
      maxDepth: 4,
      maxDurationMs: 1_200_000,
      discoveredRoutes: 1,
      visitedRoutes: 1,
    },
    routes: [{ url: 'https://example.com/', status: 'PARTIAL', scenarios: [] }],
    limitations: ['Synthetic fixture.'],
  };
}

describe('shared contracts', () => {
  it('is deterministic while rejecting non-JSON values', async () => {
    expect(stableJson({ z: [3, 1], a: 'é' })).toBe('{"a":"é","z":[3,1]}');
    expect(await contentHash({ b: 2, a: 1 })).toBe(
      await contentHash({ a: 1, b: 2 }),
    );
    expect(await contentHash({ a: 1 })).not.toBe(await contentHash({ a: 2 }));
    for (const value of [Infinity, undefined, { a: undefined }, new Date()])
      expect(() => stableJson(value)).toThrow();
    const cycle: { value?: unknown } = {};
    cycle.value = cycle;
    expect(() => stableJson(cycle)).toThrow();
  });
  it('enforces strict schemas, origin and unvalidated null verdicts', () => {
    expect(auditReportSchema.safeParse(reportFixture()).success).toBe(true);
    expect(
      auditReportSchema.safeParse({ ...reportFixture(), passed: true }).success,
    ).toBe(false);
    expect(
      auditReportSchema.safeParse({
        ...reportFixture(),
        injected: 'unexpected',
      }).success,
    ).toBe(false);
    expect(
      auditReportSchema.safeParse({
        ...reportFixture(),
        routes: [
          { url: 'https://other.example/', status: 'SKIPPED', scenarios: [] },
        ],
      }).success,
    ).toBe(false);
    expect(
      auditReportSchema.safeParse({
        ...reportFixture(),
        endedAt: '2020-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
  it('removes URL credentials/query/hash and rejects them for public transport', () => {
    expect(
      normalizePublicUrl(
        'https://name:password@EXAMPLE.com:443/a?token=secret#fragment',
      ),
    ).toBe('https://example.com/a');
    expect(() => normalizePublicUrl('javascript:alert(1)')).toThrow();
    expect(validatePublicReport(reportFixture()).id).toBe('fixture-report');
    const fixture = reportFixture();
    fixture.routes[0].url += '?token=secret';
    expect(() => validatePublicReport(fixture)).toThrow();
  });
});

describe('autonomous inspection policy', () => {
  const context = {
    baseUrl: 'https://example.com/start',
    origin: 'https://example.com',
    depth: 1,
  };
  it('keeps exact-origin routes and bounded, deduplicated exploration', () => {
    expect(planRoute({ ...context, candidate: '/about#team' })).toMatchObject({
      allowed: true,
      url: 'https://example.com/about',
    });
    expect(
      planRoute({ ...context, candidate: 'https://sub.example.com/' }).allowed,
    ).toBe(false);
    expect(
      planRoute({ ...context, candidate: '/about', depth: 5 }).reason,
    ).toBe('DEPTH_LIMIT');
    expect(
      planRoute({
        ...context,
        candidate: '/about',
        visited: ['https://example.com/about'],
      }).reason,
    ).toBe('ALREADY_VISITED');
  });
  it('rejects transactions, dangerous schemes, secret and unapproved query parameters', () => {
    for (const candidate of [
      '/logout',
      '/deleteAccount',
      '/sign_out',
      '/logout;session=123',
      '/login',
      '/signIn',
      '/oauth/authorize',
      '/permissions/grant',
      '/%2564elete/42',
      '/checkout',
      '/profile?token=secret',
      '/about?name=private',
      'javascript:alert(1)',
      'https://user:pass@example.com/',
    ]) {
      expect(planRoute({ ...context, candidate }).allowed, candidate).toBe(
        false,
      );
    }
    expect(
      planRoute({
        ...context,
        candidate: '/about?lang=nl',
        allowedQueryKeys: ['lang'],
      }).allowed,
    ).toBe(true);
    expect(
      planRoute({
        ...context,
        candidate: '/about?auth=secret',
        allowedQueryKeys: ['auth'],
      }).allowed,
    ).toBe(false);
  });
  it('allows supported disclosures but never arbitrary or submit controls', () => {
    expect(
      evaluateAction({
        kind: 'accordion',
        ariaControls: 'faq',
        ariaExpanded: false,
      }).allowed,
    ).toBe(true);
    expect(evaluateAction({ kind: 'accordion' }).allowed).toBe(false);
    expect(evaluateAction({ kind: 'unknown', role: 'button' }).allowed).toBe(
      false,
    );
    expect(
      evaluateAction({
        kind: 'accordion',
        ariaControls: 'faq',
        ariaExpanded: false,
        inForm: true,
      }).allowed,
    ).toBe(false);
    expect(
      evaluateAction({
        kind: 'tab',
        role: 'tab',
        ariaControls: 'account',
        text: 'Delete account',
      }).allowed,
    ).toBe(false);
    expect(evaluateAction({ kind: 'link', href: '/logout' }).allowed).toBe(
      false,
    );
    for (const type of ['submit', 'SUBMIT', 'image', 'IMAGE']) {
      expect(
        evaluateAction({
          kind: 'tab',
          role: 'tab',
          ariaControls: 'panel',
          type,
        }).allowed,
      ).toBe(false);
    }
    for (const text of [
      'Log in',
      'Allow permissions',
      'Connect wallet',
      'Post',
      'Upload',
    ]) {
      expect(
        evaluateAction({
          kind: 'tab',
          role: 'tab',
          ariaControls: 'panel',
          text,
        }).allowed,
      ).toBe(false);
    }
    expect(
      evaluateAction({
        kind: 'accordion',
        ariaControls: 'login-form',
        ariaExpanded: false,
        text: 'More',
      }).allowed,
    ).toBe(false);
  });
});
