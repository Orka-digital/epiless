import { expect, it } from 'vitest';
import {
  deleteAccount,
  exportAccount,
} from '../../apps/web/src/server/account';
import {
  commitPublication,
  createIntent,
  getPublication,
  moderatePublication,
  reportAbuse,
} from '../../apps/web/src/server/publications';
import { createChallenge } from '../../apps/web/src/server/security';
import { env, fixture, publish, report, request } from './publication-fixture';
it('exports only owned data without credential material, then atomically removes all account content', async () => {
  const first = await publish('PUBLIC');
  await publish('PRIVATE');
  await publish('UNLISTED');
  const pending = await createIntent(env, request, 'alice', {
    report,
    visibility: 'PRIVATE',
    idempotencyKey: crypto.randomUUID(),
  });
  const challenge = await createChallenge(env, request, 'abuse', 'bob');
  await reportAbuse(env, request, 'bob', first.publication.id, {
    category: 'privacy',
    description: 'Sensitive content should be removed',
    challengeId: challenge.id,
    challengeToken: 'flashguard-local-test',
  });
  env.MODERATOR_USER_IDS = 'moderator';
  await moderatePublication(env, 'moderator', first.publication.id, {
    action: 'hide',
    reason: 'Sensitive content in report',
    revision: 1,
  });
  fixture.sqlite
    .prepare(
      'INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)',
    )
    .run(
      'session-alice',
      Date.now() + 10000,
      'private-session-secret',
      Date.now(),
      Date.now(),
      'alice',
    );
  fixture.sqlite
    .prepare(
      'INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .run(
      'verification-alice',
      'reset-password:secret',
      'alice',
      Date.now() + 10000,
      Date.now(),
      Date.now(),
    );
  const exported = await exportAccount(env, 'alice');
  expect(exported.account).toMatchObject({
    id: 'alice',
    email: 'alice@example.com',
  });
  expect(exported.publications).toHaveLength(3);
  expect(exported.pendingUploads).toHaveLength(1);
  expect(exported.abuseReports).toEqual([]);
  expect(JSON.stringify(exported)).not.toContain('private-session-secret');
  expect((await exportAccount(env, 'bob')).publications).toEqual([]);
  await deleteAccount(env, 'alice');
  for (const table of [
    'publications',
    'publication_intents',
    'account_usage',
    'daily_usage',
    'session',
    'verification',
    'abuse_reports',
    'moderation_events',
  ])
    expect(
      fixture.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,
    ).toBe(0);
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) AS n FROM user WHERE id='bob'")
      .get()?.n,
  ).toBe(1);
  expect(await getPublication(env, { id: first.publication.id })).toBeNull();
  await expect(
    commitPublication(env, 'alice', pending.id),
  ).rejects.toMatchObject({ status: 404 });
  const ledger = fixture.sqlite.prepare('SELECT * FROM erasure_log').all();
  expect(
    ledger.filter(
      (row) => row.action === 'delete' && row.entity_type === 'publication',
    ),
  ).toHaveLength(3);
  expect(
    ledger.some(
      (row) => row.entity_type === 'account' && row.entity_id === 'alice',
    ),
  ).toBe(true);
  expect(JSON.stringify(ledger)).not.toContain(report.origin);
  expect(fixture.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
