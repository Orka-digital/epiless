import { expect, it } from 'vitest';
import { createIntent } from '../../apps/web/src/server/publications';
import { env, fixture, report, request } from './publication-fixture';
it('does not bypass the pending quota by renewing expired durable intents', async () => {
  const input = {
    report,
    visibility: 'PRIVATE',
    idempotencyKey: crypto.randomUUID(),
  };
  const old = await createIntent(env, request, 'alice', input);
  fixture.sqlite
    .prepare('UPDATE publication_intents SET expires_at=0 WHERE id=?')
    .run(old.id);
  for (let index = 0; index < 3; index++)
    await createIntent(env, request, 'alice', {
      ...input,
      idempotencyKey: crypto.randomUUID(),
    });
  await expect(
    createIntent(env, request, 'alice', input),
  ).rejects.toMatchObject({ code: 'PENDING_QUOTA' });
  expect(
    fixture.sqlite
      .prepare('SELECT state FROM publication_intents WHERE id=?')
      .get(old.id)?.state,
  ).toBe('EXPIRED');
});
