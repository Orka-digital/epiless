import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import { database } from './client';
import { challenges } from './schema';
import type { RuntimeEnv } from '../types';

/** Expired grants are disposable; deletion cannot affect a still-valid challenge. */
export function pruneChallenges(env: RuntimeEnv, cutoff: number) {
  return database(env)
    .delete(challenges)
    .where(lt(challenges.expires_at, cutoff))
    .run();
}
/** Persist the exact action, owner and intent binding later required for consumption. */
export function insertChallenge(
  env: RuntimeEnv,
  values: typeof challenges.$inferInsert,
) {
  return database(env).insert(challenges).values(values).run();
}
/** Atomic UPDATE RETURNING claims a grant exactly once, before contacting Turnstile.
 * Null owner/intent values match only anonymous/unbound grants; expired grants cannot win.
 */
export function consumeChallenge(
  env: RuntimeEnv,
  id: string,
  action: 'auth' | 'publish' | 'abuse',
  ownerId?: string,
  intentId?: string,
) {
  return database(env)
    .update(challenges)
    .set({ used: 1 })
    .where(
      and(
        eq(challenges.id, id),
        eq(challenges.used, 0),
        gte(challenges.expires_at, Date.now()),
        eq(challenges.action, action),
        ownerId
          ? eq(challenges.owner_id, ownerId)
          : isNull(challenges.owner_id),
        intentId
          ? eq(challenges.intent_id, intentId)
          : isNull(challenges.intent_id),
      ),
    )
    .returning()
    .get();
}
