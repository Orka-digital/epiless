import type { RuntimeEnv, Visibility } from '../types';

/** INSERT SELECT keeps grant checks, quota triggers and snapshot consumption in one atomic write.
 * Conflicting intent retries do nothing; cancellation/expiry cannot publish a stale application copy.
 */
export function insertPublicationSnapshot(
  env: RuntimeEnv,
  ownerId: string,
  intentId: string,
  tokenHash: string,
  now: number,
  originAllowed: number,
) {
  return env.DB.prepare(
    `INSERT INTO publications(id,intent_id,owner_id,author_name,content_hash,visibility,report_json,origin,status,route_count,size_bytes,token_hash,published_at,public_origin_allowed)
      SELECT id,id,owner_id,(SELECT name FROM user WHERE id=owner_id),content_hash,visibility,report_json,origin,status,route_count,size_bytes,?,?,? FROM publication_intents
      WHERE id=? AND owner_id=? AND state='VERIFIED' AND canceled_at IS NULL AND expires_at>=? AND verified_until>=? ON CONFLICT(intent_id) DO NOTHING`,
  )
    .bind(tokenHash, now, originAllowed, intentId, ownerId, now, now)
    .run();
}

/** Revision-guarded mutation and append-only recovery entry commit or roll back together.
 * changes() is connection-local and must immediately follow the guarded update inside D1.batch.
 * Erasure triggers clear dependent content and adjust quota within that same transaction.
 */
export async function mutatePublication(
  env: RuntimeEnv,
  ownerId: string,
  id: string,
  revision: number,
  action: 'delete' | 'revoke' | 'visibility' | 'rotate-link',
  access?: { visibility: Visibility; tokenHash: string; originAllowed: number },
) {
  let statement: D1PreparedStatement;
  if (action === 'revoke') {
    statement = env.DB.prepare(
      "UPDATE publications SET state='REVOKED',revision=revision+1,revoked_at=? WHERE id=? AND owner_id=? AND revision=? AND state!='REVOKED'",
    ).bind(Date.now(), id, ownerId, revision);
  } else if (action === 'delete') {
    statement = env.DB.prepare(
      "UPDATE publications SET state='REVOKED',visibility='PRIVATE',report_json='null',size_bytes=0,origin='https://deleted.invalid',author_name='Verwijderd',route_count=0,status='ERROR',audited_at=0,discovered_count=0,measured_count=0,scenario_count=0,candidate_count=0,engine_version='',stop_reason='',revision=revision+1,revoked_at=? WHERE id=? AND owner_id=? AND revision=? AND size_bytes>0",
    ).bind(Date.now(), id, ownerId, revision);
  } else {
    if (!access) throw new Error('Missing publication access values');
    const { visibility, tokenHash, originAllowed } = access;
    const version = revision + 1;
    statement = env.DB.prepare(
      "UPDATE publications SET visibility=?,revision=revision+1,share_version=?,token_hash=?,public_origin_allowed=? WHERE id=? AND owner_id=? AND revision=? AND state='ACTIVE' AND (? != 'rotate-link' OR visibility='UNLISTED')",
    ).bind(
      visibility,
      version,
      tokenHash,
      originAllowed,
      id,
      ownerId,
      revision,
      action,
    );
  }
  const [result] = await env.DB.batch([
    statement,
    env.DB.prepare(
      "INSERT INTO erasure_log(id,entity_type,entity_id,action,revision,created_at) SELECT ?,'publication',id,?,revision,? FROM publications WHERE id=? AND owner_id=? AND revision=? AND changes()=1",
    ).bind(crypto.randomUUID(), action, Date.now(), id, ownerId, revision + 1),
  ]);
  return result;
}
