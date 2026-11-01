import { and, desc, eq, gt, gte, lt, or, sql } from 'drizzle-orm';
import { database } from './client';
import { publications as p } from './schema';
import type { RuntimeEnv } from '../types';

// Explicit metadata allowlist: list queries must never fetch report bodies or credentials.
const metadata = {
  id: p.id,
  origin: p.origin,
  status: p.status,
  route_count: p.route_count,
  visibility: p.visibility,
  state: p.state,
  revision: p.revision,
  published_at: p.published_at,
  content_hash: p.content_hash,
  author_name: p.author_name,
  audited_at: p.audited_at,
  discovered_count: p.discovered_count,
  measured_count: p.measured_count,
  scenario_count: p.scenario_count,
  candidate_count: p.candidate_count,
  engine_version: p.engine_version,
  stop_reason: p.stop_reason,
  public_origin_allowed: p.public_origin_allowed,
};
export type PublicationMetadata = {
  [K in keyof typeof metadata]: (typeof p.$inferSelect)[K];
};
const publicAccess = () =>
  and(
    eq(p.visibility, 'PUBLIC'),
    eq(p.state, 'ACTIVE'),
    eq(p.public_origin_allowed, 1),
  );
const before = ([time, id]: [number, string]) =>
  or(lt(p.published_at, time), and(eq(p.published_at, time), lt(p.id, id)));

/** Access filtering happens in SQL, so anonymous reads cannot retrieve private report bodies. */
export function accessiblePublication(
  env: RuntimeEnv,
  id: string,
  ownerId?: string,
  tokenHash?: string | null,
) {
  return database(env)
    .select()
    .from(p)
    .where(
      and(
        eq(p.id, id),
        or(
          ownerId ? eq(p.owner_id, ownerId) : undefined,
          and(
            eq(p.state, 'ACTIVE'),
            or(
              publicAccess(),
              tokenHash
                ? and(eq(p.visibility, 'UNLISTED'), eq(p.token_hash, tokenHash))
                : undefined,
            ),
          ),
        ),
      ),
    )
    .get();
}
/** Internal lookup only: callers must establish owner/moderator authorization before exposing data. */
export function storedPublication(env: RuntimeEnv, id: string) {
  return database(env).select().from(p).where(eq(p.id, id)).get();
}
/** Small owner-scoped lookup for mutation preconditions; never includes snapshot content. */
export function ownedPublication(env: RuntimeEnv, id: string, ownerId: string) {
  return database(env)
    .select({ id: p.id, origin: p.origin })
    .from(p)
    .where(and(eq(p.id, id), eq(p.owner_id, ownerId)))
    .get();
}
/** Stable keyset pagination, public-origin confirmation and metadata-only projection. */
export function publicPage(
  env: RuntimeEnv,
  cursor: [number, string],
  filters: {
    origin?: string;
    domain?: string;
    status?: string;
    from?: number;
    to?: number;
    criterion?: string;
  } = {},
) {
  // Prefix ranges avoid D1 LIKE/GLOB complexity limits for long domains.
  const domainRanges = filters.domain
    ? ['https://', 'http://'].map((scheme) => {
        const prefix = `${scheme}${filters.domain}`;
        return and(gte(p.origin, prefix), lt(p.origin, `${prefix}\uffff`));
      })
    : [];
  return database(env)
    .select(metadata)
    .from(p)
    .where(
      and(
        publicAccess(),
        before(cursor),
        filters.origin ? eq(p.origin, filters.origin) : undefined,
        domainRanges.length ? or(...domainRanges) : undefined,
        filters.status ? eq(p.status, filters.status) : undefined,
        filters.from !== undefined
          ? gte(p.audited_at, filters.from)
          : undefined,
        filters.to !== undefined
          ? lt(p.audited_at, filters.to + 86400000)
          : undefined,
        // Both criteria use the same non-normative measurement pipeline.
        filters.criterion ? gt(p.scenario_count, 0) : undefined,
      ),
    )
    .orderBy(desc(p.published_at), desc(p.id))
    .limit(21)
    .all();
}
/** Owner pages include link version and deletion status, but no body or token hash. */
export function ownerPage(
  env: RuntimeEnv,
  ownerId: string,
  cursor: [number, string],
) {
  return database(env)
    .select({
      ...metadata,
      size_bytes: p.size_bytes,
      moderation_reason: p.moderation_reason,
      share_version: p.share_version,
    })
    .from(p)
    .where(and(eq(p.owner_id, ownerId), before(cursor)))
    .orderBy(desc(p.published_at), desc(p.id))
    .limit(21)
    .all();
}
/** Aggregate expressions preserve SQLite's null sums for an empty public origin. */
export async function publicOverview(env: RuntimeEnv, origin: string) {
  const db = database(env);
  const totals = await db
    .select({
      reports: sql<number>`count(*)`,
      first_audit: sql<number | null>`min(${p.audited_at})`,
      last_audit: sql<number | null>`max(${p.audited_at})`,
      reports_with_candidates: sql<
        number | null
      >`sum(case when ${p.candidate_count}>0 then 1 else 0 end)`,
      candidates: sql<number | null>`sum(${p.candidate_count})`,
    })
    .from(p)
    .where(and(publicAccess(), eq(p.origin, origin)))
    .get();
  const latest = await db
    .select(metadata)
    .from(p)
    .where(and(publicAccess(), eq(p.origin, origin)))
    .orderBy(desc(p.audited_at), desc(p.published_at), desc(p.id))
    .limit(1)
    .get();
  return { totals, latest };
}
