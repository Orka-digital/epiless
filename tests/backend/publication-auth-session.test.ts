import { expect, it } from 'vitest';
import { handleApi } from '../../apps/web/src/server/router';
import { env, report } from './publication-fixture';
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
  expect(intentResponse.status, await intentResponse.clone().text()).toBe(201);
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
