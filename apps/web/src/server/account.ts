import { createAuth, requireUser } from './auth';
import { rateLimit } from './security';
import { HttpError, type RuntimeEnv } from './types';

export async function revalidateAccount(
  request: Request,
  env: RuntimeEnv,
  input: Record<string, unknown>,
) {
  const user = await requireUser(request, env, { verified: false });
  if (input.expectedAccountId !== user.id)
    throw new HttpError(
      409,
      'ACCOUNT_CHANGED',
      'Het aangemelde account is gewijzigd. Vernieuw de pagina.',
    );
  if (
    typeof input.password !== 'string' ||
    input.password.length < 1 ||
    input.password.length > 128
  )
    throw new HttpError(
      400,
      'PASSWORD_REQUIRED',
      'Bevestig deze handeling met je huidige wachtwoord.',
    );
  await rateLimit(request, env, 'account-revalidation', user.id);
  try {
    await createAuth(env).api.verifyPassword({
      headers: request.headers,
      body: { password: input.password },
    });
  } catch {
    throw new HttpError(
      401,
      'REAUTHENTICATION_REQUIRED',
      'Je wachtwoord kon niet worden bevestigd. Meld je zo nodig opnieuw aan.',
    );
  }
  return user;
}

/** Explicit owner export; credentials, session tokens and Turnstile grants never leave the server. */
export async function exportAccount(env: RuntimeEnv, ownerId: string) {
  const results = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      'SELECT id,name,email,emailVerified,createdAt,updatedAt FROM user WHERE id=?',
    ).bind(ownerId),
    env.DB.prepare(
      'SELECT id,content_hash,visibility,state,revision,report_json,published_at,revoked_at,moderation_reason FROM publications WHERE owner_id=? ORDER BY published_at,id',
    ).bind(ownerId),
    env.DB.prepare(
      "SELECT id,content_hash,visibility,state,report_json,created_at,expires_at,canceled_at FROM publication_intents WHERE owner_id=? AND state!='CONSUMED'",
    ).bind(ownerId),
    env.DB.prepare(
      'SELECT id,publication_id,category,description,state,created_at FROM abuse_reports WHERE reporter_id=?',
    ).bind(ownerId),
    env.DB.prepare(
      'SELECT id,publication_id,action,reason,created_at FROM moderation_events WHERE moderator_id=?',
    ).bind(ownerId),
    env.DB.prepare(
      'SELECT createdAt,updatedAt,expiresAt,ipAddress,userAgent FROM session WHERE userId=?',
    ).bind(ownerId),
  ]);
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    account: results[0]?.results[0],
    publications: results[1]?.results.map(({ report_json, ...metadata }) => ({
      ...metadata,
      report: JSON.parse(String(report_json)) as unknown,
    })),
    pendingUploads: results[2]?.results.map(({ report_json, ...metadata }) => ({
      ...metadata,
      report: report_json ? (JSON.parse(String(report_json)) as unknown) : null,
    })),
    abuseReports: results[3]?.results,
    moderationActions: results[4]?.results,
    sessions: results[5]?.results,
  };
}

/** D1 batch is transactional: no partial account erasure or surviving public link. */
export async function deleteAccount(env: RuntimeEnv, ownerId: string) {
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
  if (!results.at(-1)?.meta.changes)
    throw new HttpError(
      404,
      'ACCOUNT_NOT_FOUND',
      'Dit account bestaat niet meer.',
    );
  return { deleted: true };
}
