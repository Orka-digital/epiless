import { expect, it } from 'vitest';
import { createAuth } from '../../apps/web/src/server/auth';
import { handleApi } from '../../apps/web/src/server/router';
import { env, report, request } from './publication-fixture';
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
