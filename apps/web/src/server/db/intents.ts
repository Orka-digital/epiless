import { and, eq, gte, inArray, isNull, lt, ne, notExists } from 'drizzle-orm';
import { database } from './client';
import { publicationIntents as intents, publications } from './schema';
import type { RuntimeEnv } from '../types';

/** Owner scoping is included in every intent lookup, including idempotent retries. */
export function findIntent(
  env: RuntimeEnv,
  ownerId: string,
  key: { id: string } | { idempotencyKey: string },
) {
  return database(env)
    .select()
    .from(intents)
    .where(
      and(
        eq(intents.owner_id, ownerId),
        'id' in key
          ? eq(intents.id, key.id)
          : eq(intents.idempotency_key, key.idempotencyKey),
      ),
    )
    .get();
}
/** Commit preflight reads ownership and origin only; INSERT SELECT owns the actual snapshot. */
export function intentHeader(env: RuntimeEnv, ownerId: string, id: string) {
  return database(env)
    .select({
      id: intents.id,
      origin: intents.origin,
      visibility: intents.visibility,
    })
    .from(intents)
    .where(and(eq(intents.id, id), eq(intents.owner_id, ownerId)))
    .get();
}
/** Clear only expired, unconsumed snapshots; tombstones preserve idempotency. */
export function expireIntents(env: RuntimeEnv, ownerId: string, now: number) {
  return database(env)
    .update(intents)
    .set({ state: 'EXPIRED', report_json: null })
    .where(
      and(
        eq(intents.owner_id, ownerId),
        lt(intents.expires_at, now),
        inArray(intents.state, ['PENDING', 'VERIFIED']),
      ),
    )
    .run();
}
/** Database uniqueness and pending-quota triggers arbitrate concurrent inserts. */
export function insertIntent(
  env: RuntimeEnv,
  values: typeof intents.$inferInsert,
) {
  return database(env).insert(intents).values(values).run();
}
/** Renewal cannot resurrect canceled/consumed intents; the quota trigger runs in this update. */
export function renewIntent(
  env: RuntimeEnv,
  ownerId: string,
  id: string,
  json: string,
  expiresAt: number,
) {
  const db = database(env);
  return db
    .update(intents)
    .set({
      state: 'PENDING',
      report_json: json,
      expires_at: expiresAt,
      verified_until: null,
    })
    .where(
      and(
        eq(intents.id, id),
        eq(intents.owner_id, ownerId),
        isNull(intents.canceled_at),
        ne(intents.state, 'CONSUMED'),
        notExists(
          db
            .select({ id: publications.id })
            .from(publications)
            .where(eq(publications.id, id)),
        ),
      ),
    )
    .run();
}
/** Conditional update prevents verification from winning after cancellation or expiry. */
export function grantIntent(
  env: RuntimeEnv,
  ownerId: string,
  id: string,
  until: number,
  now: number,
) {
  return database(env)
    .update(intents)
    .set({ state: 'VERIFIED', verified_until: until })
    .where(
      and(
        eq(intents.id, id),
        eq(intents.owner_id, ownerId),
        eq(intents.state, 'PENDING'),
        isNull(intents.canceled_at),
        gte(intents.expires_at, now),
      ),
    )
    .run();
}
/** A consumed snapshot is never undone; cancellation strips content and prevents renewal. */
export function cancelStoredIntent(
  env: RuntimeEnv,
  ownerId: string,
  id: string,
  now: number,
) {
  return database(env)
    .update(intents)
    .set({
      state: 'EXPIRED',
      report_json: null,
      origin: 'https://deleted.invalid',
      status: 'ERROR',
      route_count: 0,
      canceled_at: now,
      verified_until: null,
    })
    .where(
      and(
        eq(intents.id, id),
        eq(intents.owner_id, ownerId),
        ne(intents.state, 'CONSUMED'),
        isNull(intents.canceled_at),
      ),
    )
    .run();
}
