import { expect, it } from 'vitest';
import {
  commitPublication,
  createIntent,
  getPublication,
  listSites,
  updatePublication,
} from '../../apps/web/src/server/publications';
import { env, fixture, publish, report, request } from './publication-fixture';
it('duplicate and concurrent retries never spend quota twice or resurrect a revoked report', async () => {
  const { intent, publication, key } = await publish();
  const retries = await Promise.all(
    Array.from({ length: 8 }, () => commitPublication(env, 'alice', intent.id)),
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
