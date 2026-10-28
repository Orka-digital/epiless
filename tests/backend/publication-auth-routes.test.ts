import { expect, it } from 'vitest';
import { handleApi } from '../../apps/web/src/server/router';
import { env } from './publication-fixture';
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
