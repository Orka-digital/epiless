import { and, asc, eq } from 'drizzle-orm';
import { database } from './client';
import { abuseReports as a, publications as p } from './schema';
import type { RuntimeEnv } from '../types';

/** Reporter-scoped idempotency lookup; no descriptions leave this query. */
export function findAbuseReport(
  env: RuntimeEnv,
  publicationId: string,
  reporterId: string,
) {
  return database(env)
    .select({ id: a.id })
    .from(a)
    .where(
      and(eq(a.publication_id, publicationId), eq(a.reporter_id, reporterId)),
    )
    .get();
}
/** The unique pair arbitrates concurrent reports without replacing existing evidence. */
export function insertAbuseReport(
  env: RuntimeEnv,
  values: typeof a.$inferInsert,
) {
  return database(env)
    .insert(a)
    .values(values)
    .onConflictDoNothing({ target: [a.publication_id, a.reporter_id] })
    .run();
}
/** Bounded metadata join; service callers must establish moderator access first. */
export function openModerationQueue(env: RuntimeEnv) {
  return database(env)
    .select({
      id: a.id,
      publicationId: a.publication_id,
      category: a.category,
      description: a.description,
      createdAt: a.created_at,
      origin: p.origin,
      visibility: p.visibility,
      state: p.state,
      revision: p.revision,
    })
    .from(a)
    .innerJoin(p, eq(p.id, a.publication_id))
    .where(eq(a.state, 'OPEN'))
    .orderBy(asc(a.created_at))
    .limit(100)
    .all();
}
