import { expect, it } from 'vitest';
import {
  getSiteReportPage,
  getSiteSummary,
  listOwnReportPage,
} from '../../apps/web/src/server/publications';
import { env, fixture, publish, report } from './publication-fixture';
it('paginates all owned and public site history without cross-owner leakage or duplicate timestamp ties', async () => {
  const ids: string[] = [];
  for (let index = 0; index < 25; index++) {
    // Fixture setup spans multiple logical quota days; quota behavior is covered separately.
    fixture.sqlite.exec('DELETE FROM daily_usage');
    ids.push(
      (await publish(index === 0 ? 'PRIVATE' : 'PUBLIC')).publication.id,
    );
  }
  fixture.sqlite.exec('UPDATE publications SET published_at=1000');
  const ownFirst = await listOwnReportPage(env, 'alice');
  expect(ownFirst.items).toHaveLength(20);
  expect(ownFirst.nextCursor).toBeTruthy();
  const ownSecond = await listOwnReportPage(env, 'alice', ownFirst.nextCursor!);
  expect(ownSecond.items).toHaveLength(5);
  expect(ownSecond.nextCursor).toBeNull();
  expect(
    new Set([...ownFirst.items, ...ownSecond.items].map((item) => item.id)),
  ).toEqual(new Set(ids));
  expect(
    (await listOwnReportPage(env, 'bob', ownFirst.nextCursor!)).items,
  ).toEqual([]);
  const siteFirst = await getSiteReportPage(env, report.origin);
  const siteSecond = await getSiteReportPage(
    env,
    report.origin,
    siteFirst.nextCursor!,
  );
  expect(siteFirst.items).toHaveLength(20);
  expect(siteSecond.items).toHaveLength(4);
  expect(
    new Set([...siteFirst.items, ...siteSecond.items].map((item) => item.id)),
  ).toEqual(new Set(ids.slice(1)));
  expect(
    (await getSiteSummary(env, report.origin, siteFirst.nextCursor!)).totals
      ?.reports,
  ).toBe(24);
  await expect(
    listOwnReportPage(env, 'alice', 'invalid'),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});
