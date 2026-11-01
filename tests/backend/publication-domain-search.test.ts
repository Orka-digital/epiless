import type { AuditReport } from '@epi-less/core';
import { expect, it } from 'vitest';
import {
  commitPublication,
  createIntent,
  listSites,
  verifyIntent,
} from '../../apps/web/src/server/publications';
import { env, report, request } from './publication-fixture';
it('searches long canonical domain prefixes without LIKE/GLOB and keeps SQL parameters literal', async () => {
  const domain = `${'long-domain-'.repeat(4)}example.net`;
  const longReport: AuditReport = {
    ...report,
    origin: `https://${domain}`,
    routes: report.routes.map((route) => ({
      ...route,
      url: route.url.replace(report.origin, `https://${domain}`),
    })),
  };
  const input = {
    report: longReport,
    visibility: 'PUBLIC',
    idempotencyKey: crypto.randomUUID(),
  };
  const intent = await createIntent(env, request, 'alice', input);
  await verifyIntent(env, request, 'alice', intent.id, {
    challengeId: intent.challenge!.id,
    token: 'flashguard-local-test',
  });
  await commitPublication(env, 'alice', intent.id);
  expect(
    (await listSites(env, { query: domain })).items.map((item) => item.id),
  ).toEqual([intent.id]);
  expect(
    (await listSites(env, { query: domain.toUpperCase() })).items,
  ).toHaveLength(1);
  expect((await listSites(env, { query: 'example.net' })).items).toHaveLength(
    0,
  );
  await expect(listSites(env, { query: '%example.net' })).rejects.toMatchObject(
    { code: 'INVALID_QUERY' },
  );
});
