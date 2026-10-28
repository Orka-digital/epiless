import { expect, it } from 'vitest';
import {
  commitPublication,
  createIntent,
  getPublication,
  listOwnReports,
  listSites,
  verifyIntent,
} from '../../apps/web/src/server/publications';
import { env, publish, report, request } from './publication-fixture';
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
  expect(await getPublication(env, { id: unlisted.publication.id })).toBeNull();
  const token = new URL(unlisted.publication.shareUrl!).searchParams.get(
    'token',
  )!;
  expect(
    (await getPublication(env, { id: unlisted.publication.id, token }))?.report,
  ).toEqual(report);
  expect(
    await getPublication(env, {
      id: unlisted.publication.id,
      token: 'f'.repeat(64),
    }),
  ).toBeNull();
});

it('binds intent and verified grant to account, bytes and visibility', async () => {
  const { intent, key } = await publish('PRIVATE');
  await expect(commitPublication(env, 'bob', intent.id)).rejects.toMatchObject({
    status: 404,
  });
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
