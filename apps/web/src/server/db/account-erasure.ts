import type { RuntimeEnv } from '../types';
/** Ordered D1 batch preserves ledger entries before deleting their source rows.
 * All dependent rows, credentials and sessions disappear atomically; any failure rolls back
 * both ledger inserts and deletion. The append-only ledger intentionally survives the account.
 */
export async function eraseAccount(env: RuntimeEnv, ownerId: string) {
  const now = Date.now();
  const ownPublications = 'SELECT id FROM publications WHERE owner_id=?';
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO erasure_log(id,entity_type,entity_id,action,revision,created_at) SELECT lower(hex(randomblob(16))),'publication',id,'delete',revision+1,? FROM publications WHERE owner_id=?",
    ).bind(now, ownerId),
    env.DB.prepare(
      "INSERT INTO erasure_log(id,entity_type,entity_id,action,revision,created_at) SELECT ?,'account',id,'delete',NULL,? FROM user WHERE id=?",
    ).bind(crypto.randomUUID(), now, ownerId),
    env.DB.prepare(
      `DELETE FROM abuse_reports WHERE reporter_id=? OR publication_id IN (${ownPublications})`,
    ).bind(ownerId, ownerId),
    env.DB.prepare(
      `DELETE FROM moderation_events WHERE moderator_id=? OR publication_id IN (${ownPublications})`,
    ).bind(ownerId, ownerId),
    env.DB.prepare(
      'DELETE FROM challenges WHERE owner_id=? OR intent_id IN (SELECT id FROM publication_intents WHERE owner_id=?)',
    ).bind(ownerId, ownerId),
    env.DB.prepare('DELETE FROM publications WHERE owner_id=?').bind(ownerId),
    env.DB.prepare('DELETE FROM publication_intents WHERE owner_id=?').bind(
      ownerId,
    ),
    env.DB.prepare('DELETE FROM account_usage WHERE owner_id=?').bind(ownerId),
    env.DB.prepare('DELETE FROM daily_usage WHERE owner_id=?').bind(ownerId),
    env.DB.prepare(
      'DELETE FROM verification WHERE value=? OR identifier=(SELECT email FROM user WHERE id=?)',
    ).bind(ownerId, ownerId),
    env.DB.prepare('DELETE FROM session WHERE userId=?').bind(ownerId),
    env.DB.prepare('DELETE FROM account WHERE userId=?').bind(ownerId),
    env.DB.prepare('DELETE FROM user WHERE id=?').bind(ownerId),
  ]);
  return results.at(-1)?.meta.changes ?? 0;
}
