import { expect, it } from 'vitest';
import {
  cancelIntent,
  commitPublication,
  createIntent,
  getPublication,
  verifyIntent,
} from '../../apps/web/src/server/publications';
import { env, fixture, publish, report, request } from './publication-fixture';
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
