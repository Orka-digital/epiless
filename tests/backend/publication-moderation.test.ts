import { expect, it } from 'vitest';
import {
  getPublication,
  listModerationQueue,
  listSites,
  moderatePublication,
  reportAbuse,
  updatePublication,
} from '../../apps/web/src/server/publications';
import { createChallenge } from '../../apps/web/src/server/security';
import { env, fixture, publish, report, request } from './publication-fixture';
it('uses revision checks and moderator authorization; hiding is immediate', async () => {
  const { publication } = await publish();
  await expect(
    updatePublication(env, 'bob', publication.id, {
      action: 'revoke',
      revision: 1,
    }),
  ).rejects.toMatchObject({ status: 404 });
  await updatePublication(env, 'alice', publication.id, {
    action: 'visibility',
    visibility: 'PUBLIC',
    revision: 1,
  });
  await expect(
    updatePublication(env, 'alice', publication.id, {
      action: 'revoke',
      revision: 1,
    }),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  await expect(
    moderatePublication(env, 'bob', publication.id, {
      action: 'hide',
      reason: 'Personal information in report',
      revision: 2,
    }),
  ).rejects.toMatchObject({ status: 403 });
  env.MODERATOR_USER_IDS = 'moderator';
  await moderatePublication(env, 'moderator', publication.id, {
    action: 'hide',
    reason: 'Personal information in report',
    revision: 2,
  });
  expect(await getPublication(env, { id: publication.id })).toBeNull();
  expect((await listSites(env)).items).toHaveLength(0);
  expect(
    fixture.sqlite.prepare('SELECT count(*) AS n FROM moderation_events').get()!
      .n,
  ).toBe(1);
  const deleted = await updatePublication(env, 'alice', publication.id, {
    action: 'delete',
    revision: 3,
  });
  expect(deleted?.report).toBeNull();
  expect(deleted?.moderationReason).toBeNull();
  expect(deleted?.stopReason).toBe('');
  expect(
    fixture.sqlite.prepare('SELECT reason FROM moderation_events').get()
      ?.reason,
  ).toBe('[report deleted]');
});

it('records dismissal without altering the report or measurement', async () => {
  const { publication } = await publish();
  const challenge = await createChallenge(env, request, 'abuse', 'bob');
  await reportAbuse(env, request, 'bob', publication.id, {
    category: 'other',
    description: 'Please check this synthetic example.',
    challengeId: challenge.id,
    challengeToken: 'flashguard-local-test',
  });
  env.MODERATOR_USER_IDS = 'moderator';
  await moderatePublication(env, 'moderator', publication.id, {
    action: 'dismiss',
    reason: 'Reviewed: no publication issue found.',
    revision: 1,
  });
  expect(await listModerationQueue(env, 'moderator')).toHaveLength(0);
  expect((await getPublication(env, { id: publication.id }))?.report).toEqual(
    report,
  );
  expect(
    fixture.sqlite.prepare('SELECT action FROM moderation_events').get()!
      .action,
  ).toBe('dismiss');
});

it('deduplicates abuse reports and restricts the review queue to configured moderators', async () => {
  const { publication } = await publish();
  const challenge = await createChallenge(env, request, 'abuse', 'bob');
  const input = {
    category: 'privacy',
    description: 'This route reveals personal information.',
    challengeId: challenge.id,
    challengeToken: 'flashguard-local-test',
  };
  await reportAbuse(env, request, 'bob', publication.id, input);
  await reportAbuse(env, request, 'bob', publication.id, input);
  await expect(listModerationQueue(env, 'bob')).rejects.toMatchObject({
    status: 403,
  });
  env.MODERATOR_USER_IDS = 'moderator';
  expect(await listModerationQueue(env, 'moderator')).toHaveLength(1);
  expect((await listSites(env)).items).toHaveLength(1);
  await moderatePublication(env, 'moderator', publication.id, {
    action: 'hide',
    reason: 'Confirmed privacy issue in route.',
    revision: 1,
  });
  expect(await listModerationQueue(env, 'moderator')).toHaveLength(0);
});
