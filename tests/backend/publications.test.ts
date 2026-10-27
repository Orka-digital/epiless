import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from './database';
import type { RuntimeEnv } from '../../apps/web/src/server/types';
import {
  cancelIntent,
  getSiteSummary,
  getSiteReportPage,
  listOwnReportPage,
  createIntent,
  verifyIntent,
  commitPublication,
  getPublication,
  listSites,
  listOwnReports,
  updatePublication,
  moderatePublication,
  reportAbuse,
  listModerationQueue,
} from '../../apps/web/src/server/publications';
import {
  createChallenge,
  verifyChallenge,
  assertMutation,
  readJson,
} from '../../apps/web/src/server/security';
import { handleApi } from '../../apps/web/src/server/router';
import type { AuditReport } from '@epi-less/core';
import { isPublicOrigin } from '../../apps/web/src/server/public-origin';
import { createAuth } from '../../apps/web/src/server/auth';
import {
  exportAccount,
  deleteAccount,
} from '../../apps/web/src/server/account';

const report: AuditReport = {
  schemaVersion: 1,
  id: 'test-audit',
  origin: 'https://example.com',
  startedAt: '2026-10-26T10:00:00Z',
  endedAt: '2026-10-26T10:01:00Z',
  engineVersion: '0.1.0',
  runnerVersion: '0.1.0',
  status: 'INCONCLUSIVE',
  passed: null,
  job: {
    state: 'PARTIAL',
    stopReason: 'BUDGET_REACHED',
    maxRoutes: 50,
    maxDepth: 4,
    maxDurationMs: 1200000,
    discoveredRoutes: 2,
    visitedRoutes: 1,
  },
  routes: [
    {
      url: 'https://example.com/',
      status: 'PARTIAL',
      reason: 'Fixture',
      scenarios: [],
    },
  ],
  limitations: ['Synthetic fixture; no actual scan.'],
};
let fixture: ReturnType<typeof testDatabase>;
let env: RuntimeEnv;
let request: Request;
beforeEach(() => {
  fixture = testDatabase();
  env = {
    DB: fixture.db,
    ENVIRONMENT: 'development',
    PUBLIC_APP_ORIGIN: 'http://localhost:4321',
    BETTER_AUTH_SECRET: 'test-auth-secret-long-enough-for-32-characters',
    SHARE_TOKEN_SECRET: 'test-share-secret-long-enough-for-32-characters',
    TURNSTILE_SITE_KEY: 'local',
    LOCAL_TURNSTILE_FIXTURE: 'true',
  };
  request = new Request('http://localhost:4321/api/publications', {
    method: 'POST',
    headers: {
      Origin: env.PUBLIC_APP_ORIGIN,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  for (const id of ['alice', 'bob', 'moderator'])
    fixture.sqlite
      .prepare(
        'INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES(?,?,?,?,?)',
      )
      .run(id, id, `${id}@example.com`, Date.now(), Date.now());
});
afterEach(() => fixture.sqlite.close());

async function publish(
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' = 'PUBLIC',
  key = crypto.randomUUID(),
) {
  const intent = await createIntent(env, request, 'alice', {
    report,
    visibility,
    idempotencyKey: key,
  });
  if (intent.challenge)
    await verifyIntent(env, request, 'alice', intent.id, {
      challengeId: intent.challenge.id,
      token: 'flashguard-local-test',
    });
  const publication = await commitPublication(env, 'alice', intent.id);
  return { intent, publication, key };
}

describe('durable publication and privacy boundaries', () => {
  it('bounds pending uploads and still resolves concurrent identical intents at that limit', async () => {
    for (let index = 0; index < 2; index++)
      await createIntent(env, request, 'alice', {
        report,
        visibility: 'PRIVATE',
        idempotencyKey: crypto.randomUUID(),
      });
    const key = crypto.randomUUID();
    const intents = await Promise.all(
      Array.from({ length: 4 }, () =>
        createIntent(env, request, 'alice', {
          report,
          visibility: 'PRIVATE',
          idempotencyKey: key,
        }),
      ),
    );
    expect(new Set(intents.map((intent) => intent.id)).size).toBe(1);
    expect(
      fixture.sqlite
        .prepare(
          "SELECT count(*) AS n FROM publication_intents WHERE state='PENDING'",
        )
        .get()!.n,
    ).toBe(3);
    await expect(
      createIntent(env, request, 'alice', {
        report,
        visibility: 'PRIVATE',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'PENDING_QUOTA' });
  });
  it('only active public reports enter index; private and unlisted require appropriate access', async () => {
    const publicResult = await publish('PUBLIC');
    const privateResult = await publish('PRIVATE');
    const unlisted = await publish('UNLISTED');
    expect((await listSites(env)).items.map((entry) => entry.id)).toEqual([
      publicResult.publication.id,
    ]);
    const own = await listOwnReports(env, 'alice');
    expect(own).toHaveLength(3);
    expect(own.every((entry) => entry.hasReport && !('report' in entry))).toBe(
      true,
    );
    expect(await listOwnReports(env, 'bob')).toHaveLength(0);
    expect(
      await getPublication(env, { id: privateResult.publication.id }),
    ).toBeNull();
    expect(
      await getPublication(env, {
        id: privateResult.publication.id,
        userId: 'bob',
      }),
    ).toBeNull();
    expect(
      (
        await getPublication(env, {
          id: privateResult.publication.id,
          userId: 'alice',
        })
      )?.report,
    ).toEqual(report);
    expect(
      await getPublication(env, { id: unlisted.publication.id }),
    ).toBeNull();
    const token = new URL(unlisted.publication.shareUrl!).searchParams.get(
      'token',
    )!;
    expect(
      (await getPublication(env, { id: unlisted.publication.id, token }))
        ?.report,
    ).toEqual(report);
    expect(
      await getPublication(env, {
        id: unlisted.publication.id,
        token: 'f'.repeat(64),
      }),
    ).toBeNull();
  });
  it('duplicate and concurrent retries never spend quota twice or resurrect a revoked report', async () => {
    const { intent, publication, key } = await publish();
    const retries = await Promise.all(
      Array.from({ length: 8 }, () =>
        commitPublication(env, 'alice', intent.id),
      ),
    );
    expect(new Set(retries.map((item) => item.id)).size).toBe(1);
    expect(
      fixture.sqlite.prepare('SELECT count FROM daily_usage').get()!.count,
    ).toBe(1);
    await updatePublication(env, 'alice', publication.id, {
      action: 'revoke',
      revision: 1,
    });
    expect(
      (
        await createIntent(env, request, 'alice', {
          report,
          visibility: 'PUBLIC',
          idempotencyKey: key,
        })
      ).publication?.state,
    ).toBe('REVOKED');
    expect((await commitPublication(env, 'alice', intent.id)).state).toBe(
      'REVOKED',
    );
    expect(await getPublication(env, { id: publication.id })).toBeNull();
    expect((await listSites(env)).items).toHaveLength(0);
  });
  it('binds intent and verified grant to account, bytes and visibility', async () => {
    const { intent, key } = await publish('PRIVATE');
    await expect(
      commitPublication(env, 'bob', intent.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createIntent(env, request, 'alice', {
        report,
        visibility: 'PUBLIC',
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      createIntent(env, request, 'alice', {
        report,
        visibility: 'PUBLIC',
        idempotencyKey: crypto.randomUUID(),
        contentHash: 'changed',
      }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_CHANGED' });
    const pending = await createIntent(env, request, 'alice', {
      report,
      visibility: 'PUBLIC',
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      commitPublication(env, 'alice', pending.id),
    ).rejects.toMatchObject({ code: 'VERIFICATION_REQUIRED' });
    await expect(
      verifyIntent(env, request, 'bob', pending.id, {
        challengeId: pending.challenge!.id,
        token: 'flashguard-local-test',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects sensitive URL parameters, unknown fields and visibility spoofing', async () => {
    for (const input of [
      { ...report, ownerId: 'bob' },
      {
        ...report,
        routes: [
          { ...report.routes[0], url: 'https://example.com/?token=secret' },
        ],
      },
    ]) {
      await expect(
        createIntent(env, request, 'alice', {
          report: input,
          visibility: 'PUBLIC',
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REPORT' });
    }
  });
  it('enforces daily quota atomically including concurrent commits', async () => {
    for (let index = 0; index < 9; index++) await publish();
    const pending = await Promise.all(
      [0, 1].map(async () => {
        const intent = await createIntent(env, request, 'alice', {
          report,
          visibility: 'PUBLIC',
          idempotencyKey: crypto.randomUUID(),
        });
        await verifyIntent(env, request, 'alice', intent.id, {
          challengeId: intent.challenge!.id,
          token: 'flashguard-local-test',
        });
        return intent;
      }),
    );
    const results = await Promise.allSettled(
      pending.map((intent) => commitPublication(env, 'alice', intent.id)),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      fixture.sqlite.prepare('SELECT count FROM daily_usage').get()!.count,
    ).toBe(10);
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM publications').get()!.n,
    ).toBe(10);
  });
  it('enforces storage quota with rollback and refuses an expired grant', async () => {
    fixture.sqlite
      .prepare('INSERT INTO account_usage(owner_id,size_bytes) VALUES(?,?)')
      .run('alice', 26_214_400);
    const intent = await createIntent(env, request, 'alice', {
      report,
      visibility: 'PUBLIC',
      idempotencyKey: crypto.randomUUID(),
    });
    await verifyIntent(env, request, 'alice', intent.id, {
      challengeId: intent.challenge!.id,
      token: 'flashguard-local-test',
    });
    await expect(
      commitPublication(env, 'alice', intent.id),
    ).rejects.toMatchObject({ code: 'ACCOUNT_QUOTA' });
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM daily_usage').get()!.n,
    ).toBe(0);
    expect(
      fixture.sqlite
        .prepare('SELECT state FROM publication_intents WHERE id=?')
        .get(intent.id)!.state,
    ).toBe('VERIFIED');
    fixture.sqlite
      .prepare('UPDATE publication_intents SET verified_until=0 WHERE id=?')
      .run(intent.id);
    await expect(
      commitPublication(env, 'alice', intent.id),
    ).rejects.toMatchObject({ code: 'VERIFICATION_REQUIRED' });
  });
  it('uses revision checks and moderator authorization; hiding is immediate', async () => {
    const { publication } = await publish();
    await expect(
      updatePublication(env, 'bob', publication.id, {
        action: 'revoke',
        revision: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await updatePublication(env, 'alice', publication.id, {
      action: 'visibility',
      visibility: 'PUBLIC',
      revision: 1,
    });
    await expect(
      updatePublication(env, 'alice', publication.id, {
        action: 'revoke',
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(
      moderatePublication(env, 'bob', publication.id, {
        action: 'hide',
        reason: 'Personal information in report',
        revision: 2,
      }),
    ).rejects.toMatchObject({ status: 403 });
    env.MODERATOR_USER_IDS = 'moderator';
    await moderatePublication(env, 'moderator', publication.id, {
      action: 'hide',
      reason: 'Personal information in report',
      revision: 2,
    });
    expect(await getPublication(env, { id: publication.id })).toBeNull();
    expect((await listSites(env)).items).toHaveLength(0);
    expect(
      fixture.sqlite
        .prepare('SELECT count(*) AS n FROM moderation_events')
        .get()!.n,
    ).toBe(1);
    const deleted = await updatePublication(env, 'alice', publication.id, {
      action: 'delete',
      revision: 3,
    });
    expect(deleted?.report).toBeNull();
    expect(deleted?.moderationReason).toBeNull();
    expect(deleted?.stopReason).toBe('');
    expect(
      fixture.sqlite.prepare('SELECT reason FROM moderation_events').get()
        ?.reason,
    ).toBe('[report deleted]');
  });
  it('rotates unlisted links after visibility changes and deletes payload without resurrection', async () => {
    const { publication, intent } = await publish('UNLISTED');
    const token = new URL(publication.shareUrl!).searchParams.get('token')!;
    await updatePublication(env, 'alice', publication.id, {
      action: 'visibility',
      visibility: 'PRIVATE',
      revision: 1,
    });
    const changed = await updatePublication(env, 'alice', publication.id, {
      action: 'visibility',
      visibility: 'UNLISTED',
      revision: 2,
    });
    expect(await getPublication(env, { id: publication.id, token })).toBeNull();
    expect(changed?.shareUrl).not.toBe(publication.shareUrl);
    const erased = await updatePublication(env, 'alice', publication.id, {
      action: 'delete',
      revision: 3,
    });
    expect(erased?.report).toBeNull();
    expect(
      fixture.sqlite.prepare('SELECT size_bytes FROM account_usage').get()!
        .size_bytes,
    ).toBe(0);
    expect(
      fixture.sqlite.prepare('SELECT count FROM daily_usage').get()!.count,
    ).toBe(1);
    expect(
      (await commitPublication(env, 'alice', intent.id)).report,
    ).toBeNull();
  });
});

describe('challenge, network and session security', () => {
  it('bounds public account metadata at the server before expensive auth work', async () => {
    const response = await handleApi(
      new Request(`${env.PUBLIC_APP_ORIGIN}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          Origin: env.PUBLIC_APP_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'x'.repeat(61),
          email: 'member@example.com',
          password: 'long-fixture-password-2026',
        }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'PROFILE_INVALID' },
    });
  });
  it('rejects noncanonical auth routes before the maintained auth handler can normalize them', async () => {
    for (const path of [
      '/api/auth/sign-up%2Femail',
      '/api/auth/sign-up/email//',
      '/api/auth/other',
    ]) {
      const response = await handleApi(
        new Request(`${env.PUBLIC_APP_ORIGIN}${path}`, {
          method: 'POST',
          headers: {
            Origin: env.PUBLIC_APP_ORIGIN,
            'Content-Type': 'application/json',
          },
          body: '{}',
        }),
        env,
      );
      expect([400, 404]).toContain(response.status);
    }
  });
  it('records dismissal without altering the report or measurement', async () => {
    const { publication } = await publish();
    const challenge = await createChallenge(env, request, 'abuse', 'bob');
    await reportAbuse(env, request, 'bob', publication.id, {
      category: 'other',
      description: 'Please check this synthetic example.',
      challengeId: challenge.id,
      challengeToken: 'flashguard-local-test',
    });
    env.MODERATOR_USER_IDS = 'moderator';
    await moderatePublication(env, 'moderator', publication.id, {
      action: 'dismiss',
      reason: 'Reviewed: no publication issue found.',
      revision: 1,
    });
    expect(await listModerationQueue(env, 'moderator')).toHaveLength(0);
    expect((await getPublication(env, { id: publication.id }))?.report).toEqual(
      report,
    );
    expect(
      fixture.sqlite.prepare('SELECT action FROM moderation_events').get()!
        .action,
    ).toBe('dismiss');
  });
  it('deduplicates abuse reports and restricts the review queue to configured moderators', async () => {
    const { publication } = await publish();
    const challenge = await createChallenge(env, request, 'abuse', 'bob');
    const input = {
      category: 'privacy',
      description: 'This route reveals personal information.',
      challengeId: challenge.id,
      challengeToken: 'flashguard-local-test',
    };
    await reportAbuse(env, request, 'bob', publication.id, input);
    await reportAbuse(env, request, 'bob', publication.id, input);
    await expect(listModerationQueue(env, 'bob')).rejects.toMatchObject({
      status: 403,
    });
    env.MODERATOR_USER_IDS = 'moderator';
    expect(await listModerationQueue(env, 'moderator')).toHaveLength(1);
    expect((await listSites(env)).items).toHaveLength(1);
    await moderatePublication(env, 'moderator', publication.id, {
      action: 'hide',
      reason: 'Confirmed privacy issue in route.',
      revision: 1,
    });
    expect(await listModerationQueue(env, 'moderator')).toHaveLength(0);
  });
  it('checks hostname, action and cdata and consumes each challenge exactly once', async () => {
    env.LOCAL_TURNSTILE_FIXTURE = 'false';
    env.TURNSTILE_SECRET_KEY = 'test';
    env.TURNSTILE_HOSTNAMES = 'localhost';
    for (const override of [
      { hostname: 'evil.example' },
      { action: 'wrong' },
      { cdata: 'wrong' },
      { success: false },
    ]) {
      const challenge = await createChallenge(env, request, 'auth');
      const fetcher = async () =>
        Response.json({
          success: true,
          hostname: 'localhost',
          action: 'auth',
          cdata: challenge.cdata,
          ...override,
        });
      await expect(
        verifyChallenge(
          env,
          request,
          { action: 'auth', challengeId: challenge.id, token: 'fake' },
          fetcher as typeof fetch,
        ),
      ).rejects.toMatchObject({ code: 'CHALLENGE_REJECTED' });
    }
    const challenge = await createChallenge(env, request, 'auth');
    const fetcher = async () =>
      Response.json({
        success: true,
        hostname: 'localhost',
        action: 'auth',
        cdata: challenge.cdata,
      });
    await verifyChallenge(
      env,
      request,
      { action: 'auth', challengeId: challenge.id, token: 'fake' },
      fetcher as typeof fetch,
    );
    await expect(
      verifyChallenge(
        env,
        request,
        { action: 'auth', challengeId: challenge.id, token: 'fake' },
        fetcher as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
  });
  it('fails closed during provider outage; revocation remains independent', async () => {
    const { publication } = await publish();
    env.LOCAL_TURNSTILE_FIXTURE = 'false';
    env.TURNSTILE_SECRET_KEY = 'test';
    env.TURNSTILE_HOSTNAMES = 'localhost';
    const challenge = await createChallenge(env, request, 'auth');
    await expect(
      verifyChallenge(
        env,
        request,
        { action: 'auth', challengeId: challenge.id, token: 'fake' },
        async () => {
          throw new Error('offline');
        },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      (
        await updatePublication(env, 'alice', publication.id, {
          action: 'revoke',
          revision: 1,
        })
      )?.state,
    ).toBe('REVOKED');
  });
  it('requires same origin and rejects oversized streaming bodies', async () => {
    expect(() =>
      assertMutation(
        new Request(request.url, {
          method: 'POST',
          headers: {
            Origin: 'https://evil.example',
            'Content-Type': 'application/json',
          },
        }),
        env,
      ),
    ).toThrow();
    await expect(
      readJson(
        new Request(request.url, { method: 'POST', body: 'x'.repeat(40) }),
        32,
      ),
    ).rejects.toMatchObject({ status: 413 });
    const response = await handleApi(
      new Request(request.url, {
        method: 'POST',
        headers: {
          Origin: env.PUBLIC_APP_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
      { ...env, ENVIRONMENT: 'production' },
    );
    expect(response.status).toBe(503);
  });
  it('never accepts local fixtures or official dummy keys in a production environment', async () => {
    const production = {
      ...env,
      ENVIRONMENT: 'production' as const,
      PUBLIC_APP_ORIGIN: 'https://index.example.com',
      LOCAL_TURNSTILE_FIXTURE: 'false',
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
      TURNSTILE_HOSTNAMES: 'index.example.com',
      READ_RATE_LIMITER: { limit: async () => ({ success: true }) },
      WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    };
    const hosted = new Request(
      'https://index.example.com/api/security/challenge',
      {
        method: 'POST',
        headers: {
          Origin: production.PUBLIC_APP_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );
    const challenge = await createChallenge(production, hosted, 'auth');
    expect(challenge.local).toBe(false);
    let contacted = false;
    await expect(
      verifyChallenge(
        production,
        hosted,
        {
          action: 'auth',
          challengeId: challenge.id,
          token: 'flashguard-local-test',
        },
        async () => {
          contacted = true;
          return Response.json({ success: true });
        },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(contacted).toBe(false);
    const result = await handleApi(hosted, {
      ...production,
      LOCAL_TURNSTILE_FIXTURE: 'true',
    });
    expect(result.status).toBe(503);
    expect(
      (await handleApi(hosted, { ...production, ENVIRONMENT: 'development' }))
        .status,
    ).toBe(503);
  });
  it('creates and authenticates a real Better Auth account, then publishes with its session', async () => {
    let counter = 0;
    async function post(
      path: string,
      body: unknown,
      extra: Record<string, string> = {},
    ) {
      return handleApi(
        new Request(`${env.PUBLIC_APP_ORIGIN}${path}`, {
          method: 'POST',
          headers: {
            Origin: env.PUBLIC_APP_ORIGIN,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': `192.0.2.${++counter}`,
            ...extra,
          },
          body: JSON.stringify(body),
        }),
        env,
      );
    }
    const challenge = (await (
      await post('/api/security/challenge', { action: 'auth' })
    ).json()) as { id: string };
    const signup = await post(
      '/api/auth/sign-up/email',
      {
        name: 'Community member',
        email: 'member@example.com',
        password: 'long-fixture-password-2026',
      },
      {
        'x-flashguard-challenge': challenge.id,
        'x-captcha-response': 'flashguard-local-test',
      },
    );
    expect(signup.status, await signup.clone().text()).toBe(200);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect(cookie).toContain('session_token');
    const intentResponse = await post(
      '/api/publications/intents',
      { report, visibility: 'PUBLIC', idempotencyKey: crypto.randomUUID() },
      { Cookie: cookie },
    );
    expect(intentResponse.status, await intentResponse.clone().text()).toBe(
      201,
    );
    const intent = (await intentResponse.json()) as {
      id: string;
      challenge: { id: string };
    };
    expect(
      (
        await post(
          `/api/publications/intents/${intent.id}/verify`,
          { challengeId: intent.challenge.id, token: 'flashguard-local-test' },
          { Cookie: cookie },
        )
      ).status,
    ).toBe(200);
    const published = await post(
      '/api/publications',
      { intentId: intent.id },
      { Cookie: cookie },
    );
    expect(published.status, await published.clone().text()).toBe(201);
    expect(published.headers.get('cache-control')).toContain('no-store');
    const production = {
      ...env,
      ENVIRONMENT: 'production' as const,
      PUBLIC_APP_ORIGIN: 'https://index.example.com',
      LOCAL_TURNSTILE_FIXTURE: 'false',
      READ_RATE_LIMITER: { limit: async () => ({ success: true }) },
      WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    };
    const secureCookie = cookie.replace(
      'better-auth.session_token=',
      '__Secure-better-auth.session_token=',
    );
    const productionPost = (path: string, method: string, body: unknown) =>
      handleApi(
        new Request(`${production.PUBLIC_APP_ORIGIN}${path}`, {
          method,
          headers: {
            Origin: production.PUBLIC_APP_ORIGIN,
            'Content-Type': 'application/json',
            Cookie: secureCookie,
          },
          body: JSON.stringify(body),
        }),
        production,
      );
    // Existing identity can withdraw data even after losing email verification;
    // new publications still require verified email and no Turnstile fallback.
    expect(
      (
        await productionPost('/api/publications', 'POST', {
          intentId: intent.id,
        })
      ).status,
    ).toBe(403);
    const withdrawal = await productionPost(
      `/api/publications/${intent.id}`,
      'PATCH',
      { action: 'revoke', revision: 1 },
    );
    expect(withdrawal.status, await withdrawal.clone().text()).toBe(200);
    const signout = await post('/api/auth/sign-out', {}, { Cookie: cookie });
    expect(signout.status).toBe(200);
    expect(
      (
        await post(
          '/api/publications',
          { intentId: intent.id },
          { Cookie: cookie },
        )
      ).status,
    ).toBe(401);
  });
});

describe('P0 account management, index and durable uploads', () => {
  it('filters on actual audit date/status/measured criterion and excludes hidden scopes from summaries', async () => {
    const measured: AuditReport = structuredClone(report);
    measured.status = 'NEEDS_REVIEW';
    measured.routes[0]!.scenarios.push({
      id: 'view',
      type: 'initial-view',
      startedAt: measured.startedAt,
      endedAt: measured.endedAt,
      quality: {
        frameCount: 120,
        effectiveFps: 60,
        maxGapMs: 20,
        width: 320,
        height: 180,
        downsampled: true,
        interrupted: false,
      },
      findings: [
        {
          id: 'candidate',
          type: 'GENERAL_FLASH',
          severity: 'warning',
          reviewStatus: 'NEEDS_REVIEW',
          startMs: 0,
          endMs: 1000,
          flashesInWindow: 4,
          affectedRatio: 0.2,
          message: 'Needs examination',
        },
      ],
    });
    const intent = await createIntent(env, request, 'alice', {
      report: measured,
      visibility: 'PUBLIC',
      idempotencyKey: crypto.randomUUID(),
    });
    await verifyIntent(env, request, 'alice', intent.id, {
      challengeId: intent.challenge!.id,
      token: 'flashguard-local-test',
    });
    await commitPublication(env, 'alice', intent.id);
    await publish('PRIVATE');
    await publish('UNLISTED');
    expect(
      (
        await listSites(env, {
          from: '2026-10-26',
          to: '2026-10-26',
          status: 'NEEDS_REVIEW',
          criterion: '2.3.1',
        })
      ).items.map((p) => p.id),
    ).toEqual([intent.id]);
    expect((await listSites(env, { from: '2026-10-27' })).items).toEqual([]);
    expect((await listSites(env, { status: 'INCONCLUSIVE' })).items).toEqual(
      [],
    );
    for (const invalid of [
      { from: '2026-02-30' },
      { from: '2026-12-01', to: '2026-01-01' },
      { criterion: '1.1.1' },
      { status: 'SAFE' },
    ])
      await expect(listSites(env, invalid)).rejects.toMatchObject({
        code: 'INVALID_FILTER',
      });
    const summary = await getSiteSummary(env, report.origin);
    expect(summary.totals).toMatchObject({
      reports: 1,
      reports_with_candidates: 1,
      candidates: 1,
    });
    expect(summary.latest).toMatchObject({
      measuredRoutes: 1,
      discoveredRoutes: 2,
      scenarioCount: 1,
      candidateCount: 1,
      engineVersion: '0.1.0',
    });
    expect(summary.latest).not.toHaveProperty('report');
    await updatePublication(env, 'alice', intent.id, {
      revision: 1,
      action: 'revoke',
    });
    expect((await getSiteSummary(env, report.origin)).totals?.reports).toBe(0);
  });

  it('keeps expired/canceled upload identities stable and never resurrects consumed content', async () => {
    const key = crypto.randomUUID();
    const input = { report, visibility: 'PRIVATE', idempotencyKey: key };
    const original = await createIntent(env, request, 'alice', input);
    fixture.sqlite
      .prepare('UPDATE publication_intents SET expires_at=0 WHERE id=?')
      .run(original.id);
    const renewed = await createIntent(env, request, 'alice', input);
    expect(renewed.id).toBe(original.id);
    expect(renewed.challenge?.id).not.toBe(original.challenge?.id);
    await verifyIntent(env, request, 'alice', renewed.id, {
      challengeId: renewed.challenge!.id,
      token: 'flashguard-local-test',
    });
    await expect(
      cancelIntent(env, 'bob', renewed.id, {
        contentHash: renewed.contentHash,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      cancelIntent(env, 'alice', renewed.id, { contentHash: 'wrong' }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_CHANGED' });
    expect(
      await cancelIntent(env, 'alice', renewed.id, {
        contentHash: renewed.contentHash,
      }),
    ).toMatchObject({ state: 'CANCELLED' });
    await expect(
      commitPublication(env, 'alice', renewed.id),
    ).rejects.toMatchObject({ code: 'VERIFICATION_REQUIRED' });
    await expect(
      createIntent(env, request, 'alice', input),
    ).rejects.toMatchObject({ code: 'INTENT_CANCELLED' });
    expect(
      fixture.sqlite
        .prepare('SELECT report_json FROM publication_intents WHERE id=?')
        .get(renewed.id)?.report_json,
    ).toBeNull();
    const committed = await publish();
    expect(
      await cancelIntent(env, 'alice', committed.intent.id, {
        contentHash: committed.intent.contentHash,
      }),
    ).toMatchObject({
      state: 'CONSUMED',
      publication: { id: committed.publication.id },
    });
    expect(
      await getPublication(env, { id: committed.publication.id }),
    ).not.toBeNull();
  });

  it('supports explicit token rotation and commits withdrawal ledger entries atomically', async () => {
    const { publication } = await publish('UNLISTED');
    const token = new URL(publication.shareUrl!).searchParams.get('token')!;
    const rotated = await updatePublication(env, 'alice', publication.id, {
      action: 'rotate-link',
      revision: 1,
    });
    expect(rotated?.shareUrl).not.toBe(publication.shareUrl);
    expect(await getPublication(env, { id: publication.id, token })).toBeNull();
    expect(
      fixture.sqlite.prepare('SELECT action,revision FROM erasure_log').get(),
    ).toMatchObject({ action: 'rotate-link', revision: 2 });
    expect(() => fixture.sqlite.exec('DELETE FROM erasure_log')).toThrow(
      'APPEND_ONLY',
    );
    fixture.sqlite.exec(
      "CREATE TRIGGER test_ledger_failure BEFORE INSERT ON erasure_log BEGIN SELECT RAISE(ABORT,'LEDGER_UNAVAILABLE'); END;",
    );
    await expect(
      updatePublication(env, 'alice', publication.id, {
        action: 'delete',
        revision: 2,
      }),
    ).rejects.toThrow('LEDGER_UNAVAILABLE');
    expect(
      (await getPublication(env, { id: publication.id, userId: 'alice' }))
        ?.report,
    ).toEqual(report);
    expect(
      fixture.sqlite
        .prepare('SELECT revision FROM publications WHERE id=?')
        .get(publication.id)?.revision,
    ).toBe(2);
  });

  it('exports only owned data without credential material, then atomically removes all account content', async () => {
    const first = await publish('PUBLIC');
    await publish('PRIVATE');
    await publish('UNLISTED');
    const pending = await createIntent(env, request, 'alice', {
      report,
      visibility: 'PRIVATE',
      idempotencyKey: crypto.randomUUID(),
    });
    const challenge = await createChallenge(env, request, 'abuse', 'bob');
    await reportAbuse(env, request, 'bob', first.publication.id, {
      category: 'privacy',
      description: 'Sensitive content should be removed',
      challengeId: challenge.id,
      challengeToken: 'flashguard-local-test',
    });
    env.MODERATOR_USER_IDS = 'moderator';
    await moderatePublication(env, 'moderator', first.publication.id, {
      action: 'hide',
      reason: 'Sensitive content in report',
      revision: 1,
    });
    fixture.sqlite
      .prepare(
        'INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)',
      )
      .run(
        'session-alice',
        Date.now() + 10000,
        'private-session-secret',
        Date.now(),
        Date.now(),
        'alice',
      );
    fixture.sqlite
      .prepare(
        'INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .run(
        'verification-alice',
        'reset-password:secret',
        'alice',
        Date.now() + 10000,
        Date.now(),
        Date.now(),
      );
    const exported = await exportAccount(env, 'alice');
    expect(exported.account).toMatchObject({
      id: 'alice',
      email: 'alice@example.com',
    });
    expect(exported.publications).toHaveLength(3);
    expect(exported.pendingUploads).toHaveLength(1);
    expect(exported.abuseReports).toEqual([]);
    expect(JSON.stringify(exported)).not.toContain('private-session-secret');
    expect((await exportAccount(env, 'bob')).publications).toEqual([]);
    await deleteAccount(env, 'alice');
    for (const table of [
      'publications',
      'publication_intents',
      'account_usage',
      'daily_usage',
      'session',
      'verification',
      'abuse_reports',
      'moderation_events',
    ])
      expect(
        fixture.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,
      ).toBe(0);
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) AS n FROM user WHERE id='bob'")
        .get()?.n,
    ).toBe(1);
    expect(await getPublication(env, { id: first.publication.id })).toBeNull();
    await expect(
      commitPublication(env, 'alice', pending.id),
    ).rejects.toMatchObject({ status: 404 });
    const ledger = fixture.sqlite.prepare('SELECT * FROM erasure_log').all();
    expect(
      ledger.filter(
        (row) => row.action === 'delete' && row.entity_type === 'publication',
      ),
    ).toHaveLength(3);
    expect(
      ledger.some(
        (row) => row.entity_type === 'account' && row.entity_id === 'alice',
      ),
    ).toBe(true);
    expect(JSON.stringify(ledger)).not.toContain(report.origin);
    expect(fixture.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual(
      [],
    );
  });

  it('requires the current password, explicit deletion confirmation and expected session account at HTTP boundary', async () => {
    const password = 'local-account-fixture-password';
    const signup = await createAuth(env).api.signUpEmail({
      body: {
        name: 'Local account',
        email: 'local-account@example.com',
        password,
      },
      headers: request.headers,
      asResponse: true,
    });
    expect(signup.status).toBe(200);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const { user } = (await signup.json()) as { user: { id: string } };
    const call = (path: string, body: unknown) =>
      handleApi(
        new Request(`${env.PUBLIC_APP_ORIGIN}${path}`, {
          method: 'POST',
          headers: {
            Origin: env.PUBLIC_APP_ORIGIN,
            'Content-Type': 'application/json',
            cookie,
          },
          body: JSON.stringify(body),
        }),
        env,
      );
    const wrong = await call('/api/account/delete', {
      expectedAccountId: user.id,
      password: 'wrong-password',
      confirmation: 'VERWIJDER',
    });
    expect(wrong.status).toBe(401);
    const changed = await call('/api/publications/intents', {
      expectedAccountId: 'bob',
      report,
      visibility: 'PRIVATE',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({
      error: { code: 'ACCOUNT_CHANGED' },
    });
    const exported = await call('/api/account/export', {
      expectedAccountId: user.id,
      password,
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('Cache-Control')).toContain('no-store');
    expect(await exported.json()).toMatchObject({ account: { id: user.id } });
    expect(
      (
        await call('/api/account/delete', {
          expectedAccountId: user.id,
          password,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('/api/account/delete', {
          expectedAccountId: user.id,
          password,
          confirmation: 'VERWIJDER',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('/api/account/export', {
          expectedAccountId: user.id,
          password,
        })
      ).status,
    ).toBe(401);
  });

  it('keeps reads and withdrawals available when the upload budget switch is enabled', async () => {
    const existing = await publish();
    const waiting = await createIntent(env, request, 'alice', {
      report,
      visibility: 'PRIVATE',
      idempotencyKey: crypto.randomUUID(),
    });
    env.UPLOADS_PAUSED = 'true';
    await expect(
      createIntent(env, request, 'alice', {
        report,
        visibility: 'PRIVATE',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'UPLOADS_PAUSED', status: 503 });
    await expect(
      commitPublication(env, 'alice', waiting.id),
    ).rejects.toMatchObject({ code: 'UPLOADS_PAUSED' });
    expect((await commitPublication(env, 'alice', existing.intent.id)).id).toBe(
      existing.publication.id,
    );
    expect((await listSites(env)).items).toHaveLength(1);
    await updatePublication(env, 'alice', existing.publication.id, {
      action: 'revoke',
      revision: 1,
    });
    expect((await listSites(env)).items).toHaveLength(0);
  });
});

it('serves HTML through the same revocable access boundary as JSON and carries download security headers', async () => {
  const { publication } = await publish('UNLISTED');
  const token = new URL(publication.shareUrl!).searchParams.get('token')!;
  const path = `/api/publications/${publication.id}/export?format=html`;
  const get = (query: string) =>
    handleApi(new Request(`${env.PUBLIC_APP_ORIGIN}${query}`), env);
  expect((await get(path)).status).toBe(404);
  const response = await get(`${path}&token=${token}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/html');
  expect(response.headers.get('Content-Disposition')).toContain('.html');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "default-src 'none'",
  );
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(await response.text()).toContain(report.origin);
  await updatePublication(env, 'alice', publication.id, {
    action: 'revoke',
    revision: 1,
  });
  expect((await get(`${path}&token=${token}`)).status).toBe(404);
});

it('does not bypass the pending quota by renewing expired durable intents', async () => {
  const input = {
    report,
    visibility: 'PRIVATE',
    idempotencyKey: crypto.randomUUID(),
  };
  const old = await createIntent(env, request, 'alice', input);
  fixture.sqlite
    .prepare('UPDATE publication_intents SET expires_at=0 WHERE id=?')
    .run(old.id);
  for (let index = 0; index < 3; index++)
    await createIntent(env, request, 'alice', {
      ...input,
      idempotencyKey: crypto.randomUUID(),
    });
  await expect(
    createIntent(env, request, 'alice', input),
  ).rejects.toMatchObject({ code: 'PENDING_QUOTA' });
  expect(
    fixture.sqlite
      .prepare('SELECT state FROM publication_intents WHERE id=?')
      .get(old.id)?.state,
  ).toBe('EXPIRED');
});

it('paginates all owned and public site history without cross-owner leakage or duplicate timestamp ties', async () => {
  const ids: string[] = [];
  for (let index = 0; index < 25; index++) {
    // Fixture setup spans multiple logical quota days; quota behavior is covered separately.
    fixture.sqlite.exec('DELETE FROM daily_usage');
    ids.push(
      (await publish(index === 0 ? 'PRIVATE' : 'PUBLIC')).publication.id,
    );
  }
  fixture.sqlite.exec('UPDATE publications SET published_at=1000');
  const ownFirst = await listOwnReportPage(env, 'alice');
  expect(ownFirst.items).toHaveLength(20);
  expect(ownFirst.nextCursor).toBeTruthy();
  const ownSecond = await listOwnReportPage(env, 'alice', ownFirst.nextCursor!);
  expect(ownSecond.items).toHaveLength(5);
  expect(ownSecond.nextCursor).toBeNull();
  expect(
    new Set([...ownFirst.items, ...ownSecond.items].map((item) => item.id)),
  ).toEqual(new Set(ids));
  expect(
    (await listOwnReportPage(env, 'bob', ownFirst.nextCursor!)).items,
  ).toEqual([]);
  const siteFirst = await getSiteReportPage(env, report.origin);
  const siteSecond = await getSiteReportPage(
    env,
    report.origin,
    siteFirst.nextCursor!,
  );
  expect(siteFirst.items).toHaveLength(20);
  expect(siteSecond.items).toHaveLength(4);
  expect(
    new Set([...siteFirst.items, ...siteSecond.items].map((item) => item.id)),
  ).toEqual(new Set(ids.slice(1)));
  expect(
    (await getSiteSummary(env, report.origin, siteFirst.nextCursor!)).totals
      ?.reports,
  ).toBe(24);
  await expect(
    listOwnReportPage(env, 'alice', 'invalid'),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});

it('searches long canonical domain prefixes without LIKE/GLOB and keeps SQL parameters literal', async () => {
  const domain = `${'long-domain-'.repeat(4)}example.net`;
  const longReport: AuditReport = {
    ...report,
    origin: `https://${domain}`,
    routes: report.routes.map((route) => ({
      ...route,
      url: route.url.replace(report.origin, `https://${domain}`),
    })),
  };
  const input = {
    report: longReport,
    visibility: 'PUBLIC',
    idempotencyKey: crypto.randomUUID(),
  };
  const intent = await createIntent(env, request, 'alice', input);
  await verifyIntent(env, request, 'alice', intent.id, {
    challengeId: intent.challenge!.id,
    token: 'flashguard-local-test',
  });
  await commitPublication(env, 'alice', intent.id);
  expect(
    (await listSites(env, { query: domain })).items.map((item) => item.id),
  ).toEqual([intent.id]);
  expect(
    (await listSites(env, { query: domain.toUpperCase() })).items,
  ).toHaveLength(1);
  expect((await listSites(env, { query: 'example.net' })).items).toHaveLength(
    0,
  );
  await expect(listSites(env, { query: '%example.net' })).rejects.toMatchObject(
    { code: 'INVALID_QUERY' },
  );
});

it('rejects local, private, reserved and canonicalized numeric origins from new public submissions', async () => {
  const blocked = [
    'http://localhost',
    'http://localhost.',
    'http://printer',
    'https://router.local',
    'https://admin.internal',
    'https://box.home.arpa',
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://0177.0.0.1',
    'http://10.0.0.1',
    'http://172.16.1.1',
    'http://192.168.1.1',
    'http://100.64.0.1',
    'http://169.254.169.254',
    'http://0.0.0.0',
    'http://224.0.0.1',
    'http://192.0.2.1',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[fe80::1]',
    'http://[fc00::1]',
    'http://[fd12::1]',
    'http://[64:ff9b::a00:1]',
    'https://[2001:db8::1]',
    'https://[2002:7f00:1::]',
    'https://localtest.me',
    'https://127.0.0.1.nip.io',
    'https://10-0-0-1.sslip.io',
    'https://fixture.invalid',
  ];
  for (const input of blocked) {
    const origin = new URL(input).origin;
    const localReport = {
      ...report,
      origin,
      routes: [{ ...report.routes[0], url: `${origin}/` }],
    };
    expect(isPublicOrigin(origin), input).toBe(false);
    await expect(
      createIntent(env, request, 'alice', {
        report: localReport,
        visibility: 'PUBLIC',
        idempotencyKey: crypto.randomUUID(),
      }),
      input,
    ).rejects.toMatchObject({ status: 422, code: 'PUBLIC_ORIGIN_REQUIRED' });
  }
  expect(
    fixture.sqlite
      .prepare('SELECT count(*) AS n FROM publication_intents')
      .get()?.n,
  ).toBe(0);
  for (const origin of [
    'https://example.org',
    'http://sub.example.com:8080',
    'https://8.8.8.8',
    'https://[2606:4700:4700::1111]',
    'https://[2a00:1450:400e:80e::200e]',
  ])
    expect(isPublicOrigin(origin), origin).toBe(true);
});

it('preserves local private/link reports but denies publishing them through visibility changes', async () => {
  for (const visibility of ['PRIVATE', 'UNLISTED'] as const) {
    const origin =
      visibility === 'PRIVATE' ? 'http://192.168.1.1' : 'http://[::1]';
    const localReport = {
      ...report,
      origin,
      routes: [{ ...report.routes[0], url: `${origin}/` }],
    };
    const intent = await createIntent(env, request, 'alice', {
      report: localReport,
      visibility,
      idempotencyKey: crypto.randomUUID(),
    });
    await verifyIntent(env, request, 'alice', intent.id, {
      challengeId: intent.challenge!.id,
      token: 'flashguard-local-test',
    });
    const publication = await commitPublication(env, 'alice', intent.id);
    expect(publication.report).toEqual(localReport);
    await expect(
      updatePublication(env, 'alice', publication.id, {
        revision: 1,
        action: 'visibility',
        visibility: 'PUBLIC',
      }),
    ).rejects.toMatchObject({ code: 'PUBLIC_ORIGIN_REQUIRED' });
    expect(
      (await getPublication(env, { id: publication.id, userId: 'alice' }))
        ?.revision,
    ).toBe(1);
    if (publication.shareUrl) {
      const token = new URL(publication.shareUrl).searchParams.get('token')!;
      expect(
        (await getPublication(env, { id: publication.id, token }))?.report,
      ).toEqual(localReport);
    }
    expect((await getSiteSummary(env, origin)).totals?.reports).toBe(0);
  }
  expect((await listSites(env)).items).toEqual([]);
});

it('withholds legacy public rows from reads, index and summaries until safe origin publication is reconfirmed', async () => {
  const { publication } = await publish('PUBLIC');
  fixture.sqlite
    .prepare('UPDATE publications SET public_origin_allowed=0 WHERE id=?')
    .run(publication.id);
  expect(await getPublication(env, { id: publication.id })).toBeNull();
  expect((await listSites(env)).items).toEqual([]);
  expect((await getSiteSummary(env, report.origin)).totals?.reports).toBe(0);
  const owned = (await listOwnReports(env, 'alice'))[0]!;
  expect(owned).toMatchObject({
    publicAccessNeedsConfirmation: true,
    publiclyListed: false,
  });
  expect(owned.shareUrl).toBeUndefined();
  const confirmed = await updatePublication(env, 'alice', publication.id, {
    revision: 1,
    action: 'visibility',
    visibility: 'PUBLIC',
  });
  expect(confirmed?.publiclyListed).toBe(true);
  expect(await getPublication(env, { id: publication.id })).not.toBeNull();
  expect((await listSites(env)).items).toHaveLength(1);
});
