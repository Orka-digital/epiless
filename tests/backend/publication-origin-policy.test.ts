import { expect, it } from 'vitest';
import { isPublicOrigin } from '../../apps/web/src/server/public-origin';
import {
  commitPublication,
  createIntent,
  getPublication,
  getSiteSummary,
  listOwnReports,
  listSites,
  updatePublication,
  verifyIntent,
} from '../../apps/web/src/server/publications';
import { env, fixture, publish, report, request } from './publication-fixture';
it('rejects local, private, reserved and canonicalized numeric origins from new public submissions', async () => {
  const blocked = [
    'http://localhost',
    'http://localhost.',
    'http://printer',
    'https://router.local',
    'https://admin.internal',
    'https://box.home.arpa',
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://0177.0.0.1',
    'http://10.0.0.1',
    'http://172.16.1.1',
    'http://192.168.1.1',
    'http://100.64.0.1',
    'http://169.254.169.254',
    'http://0.0.0.0',
    'http://224.0.0.1',
    'http://192.0.2.1',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[fe80::1]',
    'http://[fc00::1]',
    'http://[fd12::1]',
    'http://[64:ff9b::a00:1]',
    'https://[2001:db8::1]',
    'https://[2002:7f00:1::]',
    'https://localtest.me',
    'https://127.0.0.1.nip.io',
    'https://10-0-0-1.sslip.io',
    'https://fixture.invalid',
  ];
  for (const input of blocked) {
    const origin = new URL(input).origin;
    const localReport = {
      ...report,
      origin,
      routes: [{ ...report.routes[0], url: `${origin}/` }],
    };
    expect(isPublicOrigin(origin), input).toBe(false);
    await expect(
      createIntent(env, request, 'alice', {
        report: localReport,
        visibility: 'PUBLIC',
        idempotencyKey: crypto.randomUUID(),
      }),
      input,
    ).rejects.toMatchObject({ status: 422, code: 'PUBLIC_ORIGIN_REQUIRED' });
  }
  expect(
    fixture.sqlite
      .prepare('SELECT count(*) AS n FROM publication_intents')
      .get()?.n,
  ).toBe(0);
  for (const origin of [
    'https://example.org',
    'http://sub.example.com:8080',
    'https://8.8.8.8',
    'https://[2606:4700:4700::1111]',
    'https://[2a00:1450:400e:80e::200e]',
  ])
    expect(isPublicOrigin(origin), origin).toBe(true);
});

it('preserves local private/link reports but denies publishing them through visibility changes', async () => {
  for (const visibility of ['PRIVATE', 'UNLISTED'] as const) {
    const origin =
      visibility === 'PRIVATE' ? 'http://192.168.1.1' : 'http://[::1]';
    const localReport = {
      ...report,
      origin,
      routes: [{ ...report.routes[0], url: `${origin}/` }],
    };
    const intent = await createIntent(env, request, 'alice', {
      report: localReport,
      visibility,
      idempotencyKey: crypto.randomUUID(),
    });
    await verifyIntent(env, request, 'alice', intent.id, {
      challengeId: intent.challenge!.id,
      token: 'flashguard-local-test',
    });
    const publication = await commitPublication(env, 'alice', intent.id);
    expect(publication.report).toEqual(localReport);
    await expect(
      updatePublication(env, 'alice', publication.id, {
        revision: 1,
        action: 'visibility',
        visibility: 'PUBLIC',
      }),
    ).rejects.toMatchObject({ code: 'PUBLIC_ORIGIN_REQUIRED' });
    expect(
      (await getPublication(env, { id: publication.id, userId: 'alice' }))
        ?.revision,
    ).toBe(1);
    if (publication.shareUrl) {
      const token = new URL(publication.shareUrl).searchParams.get('token')!;
      expect(
        (await getPublication(env, { id: publication.id, token }))?.report,
      ).toEqual(localReport);
    }
    expect((await getSiteSummary(env, origin)).totals?.reports).toBe(0);
  }
  expect((await listSites(env)).items).toEqual([]);
});

it('withholds legacy public rows from reads, index and summaries until safe origin publication is reconfirmed', async () => {
  const { publication } = await publish('PUBLIC');
  fixture.sqlite
    .prepare('UPDATE publications SET public_origin_allowed=0 WHERE id=?')
    .run(publication.id);
  expect(await getPublication(env, { id: publication.id })).toBeNull();
  expect((await listSites(env)).items).toEqual([]);
  expect((await getSiteSummary(env, report.origin)).totals?.reports).toBe(0);
  const owned = (await listOwnReports(env, 'alice'))[0]!;
  expect(owned).toMatchObject({
    publicAccessNeedsConfirmation: true,
    publiclyListed: false,
  });
  expect(owned.shareUrl).toBeUndefined();
  const confirmed = await updatePublication(env, 'alice', publication.id, {
    revision: 1,
    action: 'visibility',
    visibility: 'PUBLIC',
  });
  expect(confirmed?.publiclyListed).toBe(true);
  expect(await getPublication(env, { id: publication.id })).not.toBeNull();
  expect((await listSites(env)).items).toHaveLength(1);
});
