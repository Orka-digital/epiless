import { expect, it } from 'vitest';
import { handleApi } from '../../apps/web/src/server/router';
import { assertMutation, readJson } from '../../apps/web/src/server/security';
import { env, request } from './publication-fixture';
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
