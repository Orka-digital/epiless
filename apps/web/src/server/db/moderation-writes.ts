import type { RuntimeEnv } from '../types';
/** Event insertion is revision-guarded; reports close only if that event exists.
 * The D1 batch makes both steps atomic, including rollback on any constraint failure.
 */
export async function dismissReports(
  env: RuntimeEnv,
  moderatorId: string,
  id: string,
  revision: number,
  reason: string,
) {
  const eventId = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO moderation_events(id,publication_id,moderator_id,action,reason,created_at) SELECT ?,id,?,'dismiss',?,? FROM publications WHERE id=? AND revision=?",
    ).bind(eventId, moderatorId, reason, Date.now(), id, revision),
    env.DB.prepare(
      "UPDATE abuse_reports SET state='REVIEWED' WHERE publication_id=? AND EXISTS(SELECT 1 FROM moderation_events WHERE id=?)",
    ).bind(id, eventId),
  ]);
  return results[0]?.meta.changes ?? 0;
}
/** Hide, erasure ledger, moderation event and report closure share one transaction.
 * Consecutive changes() guards bind ledger/event insertion to the winning revision update;
 * preserve statement order and never split this batch across requests.
 */
export async function hidePublication(
  env: RuntimeEnv,
  moderatorId: string,
  id: string,
  revision: number,
  reason: string,
) {
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE publications SET state='HIDDEN_BY_MODERATION',moderation_reason=?,revision=revision+1 WHERE id=? AND revision=? AND state='ACTIVE'",
    ).bind(reason, id, revision),
    env.DB.prepare(
      "INSERT INTO erasure_log(id,entity_type,entity_id,action,revision,created_at) SELECT ?,'publication',id,'revoke',revision,? FROM publications WHERE id=? AND revision=? AND state='HIDDEN_BY_MODERATION' AND changes()=1",
    ).bind(crypto.randomUUID(), Date.now(), id, revision + 1),
    env.DB.prepare(
      "INSERT INTO moderation_events(id,publication_id,moderator_id,action,reason,created_at) SELECT ?,id,?,'hide',?,? FROM publications WHERE id=? AND state='HIDDEN_BY_MODERATION' AND revision=? AND changes()=1",
    ).bind(
      crypto.randomUUID(),
      moderatorId,
      reason,
      Date.now(),
      id,
      revision + 1,
    ),
    env.DB.prepare(
      "UPDATE abuse_reports SET state='REVIEWED' WHERE publication_id=? AND EXISTS(SELECT 1 FROM publications WHERE id=? AND state='HIDDEN_BY_MODERATION')",
    ).bind(id, id),
  ]);
  return results[0]?.meta.changes ?? 0;
}
