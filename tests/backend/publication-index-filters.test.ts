import type { AuditReport } from '@epi-less/core';
import { expect, it } from 'vitest';
import {
  commitPublication,
  createIntent,
  getSiteSummary,
  listSites,
  updatePublication,
  verifyIntent,
} from '../../apps/web/src/server/publications';
import { env, publish, report, request } from './publication-fixture';
it('filters on actual audit date/status/measured criterion and excludes hidden scopes from summaries', async () => {
  const measured: AuditReport = structuredClone(report);
  measured.status = 'NEEDS_REVIEW';
  measured.routes[0]!.scenarios.push({
    id: 'view',
    type: 'initial-view',
    startedAt: measured.startedAt,
    endedAt: measured.endedAt,
    quality: {
      frameCount: 120,
      effectiveFps: 60,
      maxGapMs: 20,
      width: 320,
      height: 180,
      downsampled: true,
      interrupted: false,
    },
    findings: [
      {
        id: 'candidate',
        type: 'GENERAL_FLASH',
        severity: 'warning',
        reviewStatus: 'NEEDS_REVIEW',
        startMs: 0,
        endMs: 1000,
        flashesInWindow: 4,
        affectedRatio: 0.2,
        message: 'Needs examination',
      },
    ],
  });
  const intent = await createIntent(env, request, 'alice', {
    report: measured,
    visibility: 'PUBLIC',
    idempotencyKey: crypto.randomUUID(),
  });
  await verifyIntent(env, request, 'alice', intent.id, {
    challengeId: intent.challenge!.id,
    token: 'flashguard-local-test',
  });
  await commitPublication(env, 'alice', intent.id);
  await publish('PRIVATE');
  await publish('UNLISTED');
  expect(
    (
      await listSites(env, {
        from: '2026-10-26',
        to: '2026-10-26',
        status: 'NEEDS_REVIEW',
        criterion: '2.3.1',
      })
    ).items.map((p) => p.id),
  ).toEqual([intent.id]);
  expect((await listSites(env, { from: '2026-10-27' })).items).toEqual([]);
  expect((await listSites(env, { status: 'INCONCLUSIVE' })).items).toEqual([]);
  for (const invalid of [
    { from: '2026-02-30' },
    { from: '2026-12-01', to: '2026-01-01' },
    { criterion: '1.1.1' },
    { status: 'SAFE' },
  ])
    await expect(listSites(env, invalid)).rejects.toMatchObject({
      code: 'INVALID_FILTER',
    });
  const summary = await getSiteSummary(env, report.origin);
  expect(summary.totals).toMatchObject({
    reports: 1,
    reports_with_candidates: 1,
    candidates: 1,
  });
  expect(summary.latest).toMatchObject({
    measuredRoutes: 1,
    discoveredRoutes: 2,
    scenarioCount: 1,
    candidateCount: 1,
    engineVersion: '0.1.0',
  });
  expect(summary.latest).not.toHaveProperty('report');
  await updatePublication(env, 'alice', intent.id, {
    revision: 1,
    action: 'revoke',
  });
  expect((await getSiteSummary(env, report.origin)).totals?.reports).toBe(0);
});
