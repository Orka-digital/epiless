import { expect, it } from 'vitest';
import {
  commitPublication,
  createIntent,
  verifyIntent,
} from '../../apps/web/src/server/publications';
import { env, fixture, publish, report, request } from './publication-fixture';
it('bounds pending uploads and still resolves concurrent identical intents at that limit', async () => {
  for (let index = 0; index < 2; index++)
    await createIntent(env, request, 'alice', {
      report,
      visibility: 'PRIVATE',
      idempotencyKey: crypto.randomUUID(),
    });
  const key = crypto.randomUUID();
  const intents = await Promise.all(
    Array.from({ length: 4 }, () =>
      createIntent(env, request, 'alice', {
        report,
        visibility: 'PRIVATE',
        idempotencyKey: key,
      }),
    ),
  );
  expect(new Set(intents.map((intent) => intent.id)).size).toBe(1);
  expect(
    fixture.sqlite
      .prepare(
        "SELECT count(*) AS n FROM publication_intents WHERE state='PENDING'",
      )
      .get()!.n,
  ).toBe(3);
  await expect(
    createIntent(env, request, 'alice', {
      report,
      visibility: 'PRIVATE',
      idempotencyKey: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'PENDING_QUOTA' });
});

it('enforces daily quota atomically including concurrent commits', async () => {
  for (let index = 0; index < 9; index++) await publish();
  const pending = await Promise.all(
    [0, 1].map(async () => {
      const intent = await createIntent(env, request, 'alice', {
        report,
        visibility: 'PUBLIC',
        idempotencyKey: crypto.randomUUID(),
      });
      await verifyIntent(env, request, 'alice', intent.id, {
        challengeId: intent.challenge!.id,
        token: 'flashguard-local-test',
      });
      return intent;
    }),
  );
  const results = await Promise.allSettled(
    pending.map((intent) => commitPublication(env, 'alice', intent.id)),
  );
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  expect(
    fixture.sqlite.prepare('SELECT count FROM daily_usage').get()!.count,
  ).toBe(10);
  expect(
    fixture.sqlite.prepare('SELECT count(*) AS n FROM publications').get()!.n,
  ).toBe(10);
});

it('enforces storage quota with rollback and refuses an expired grant', async () => {
  fixture.sqlite
    .prepare('INSERT INTO account_usage(owner_id,size_bytes) VALUES(?,?)')
    .run('alice', 26_214_400);
  const intent = await createIntent(env, request, 'alice', {
    report,
    visibility: 'PUBLIC',
    idempotencyKey: crypto.randomUUID(),
  });
  await verifyIntent(env, request, 'alice', intent.id, {
    challengeId: intent.challenge!.id,
    token: 'flashguard-local-test',
  });
  await expect(
    commitPublication(env, 'alice', intent.id),
  ).rejects.toMatchObject({ code: 'ACCOUNT_QUOTA' });
  expect(
    fixture.sqlite.prepare('SELECT count(*) AS n FROM daily_usage').get()!.n,
  ).toBe(0);
  expect(
    fixture.sqlite
      .prepare('SELECT state FROM publication_intents WHERE id=?')
      .get(intent.id)!.state,
  ).toBe('VERIFIED');
  fixture.sqlite
    .prepare('UPDATE publication_intents SET verified_until=0 WHERE id=?')
    .run(intent.id);
  await expect(
    commitPublication(env, 'alice', intent.id),
  ).rejects.toMatchObject({ code: 'VERIFICATION_REQUIRED' });
});
