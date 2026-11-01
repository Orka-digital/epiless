import { expect, it } from 'vitest';
import { updatePublication } from '../../apps/web/src/server/publications';
import { handleApi } from '../../apps/web/src/server/router';
import { env, publish, report } from './publication-fixture';
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
