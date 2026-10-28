import { expect, it } from 'vitest';
import {
  commitPublication,
  getPublication,
  updatePublication,
} from '../../apps/web/src/server/publications';
import { env, fixture, publish, report } from './publication-fixture';
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
  expect((await commitPublication(env, 'alice', intent.id)).report).toBeNull();
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
