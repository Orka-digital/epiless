import { expect, it } from 'vitest';
import { updatePublication } from '../../apps/web/src/server/publications';
import { handleApi } from '../../apps/web/src/server/router';
import {
  createChallenge,
  verifyChallenge,
} from '../../apps/web/src/server/security';
import { env, publish, request } from './publication-fixture';
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
