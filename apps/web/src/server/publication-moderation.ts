import { type AuditReport } from '@epi-less/core';
import { summarize } from './publication-presentation';
import { getPublication } from './publication-queries';
import {
  type ModerationItem,
  type PublicationDetail,
  type PublicationRow,
} from './publication-types';
import { verifyChallenge } from './security';
import { HttpError, type RuntimeEnv } from './types';

/**
 * Accept one challenge-verified abuse report per reporter and accessible snapshot.
 * @param env - Database and challenge bindings.
 * @param request - Request used for anti-abuse verification.
 * @param ownerId - Authenticated reporter, not necessarily the publication owner.
 * @param id - Publication to report.
 * @param input - Untrusted category, description, challenge and optional share token.
 * @returns An idempotent acceptance result.
 * @throws HttpError if the report is inaccessible or verification fails.
 */
export async function reportAbuse(
  env: RuntimeEnv,
  request: Request,
  ownerId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const accessible = await getPublication(env, {
    id,
    token: typeof input.token === 'string' ? input.token : undefined,
    userId: ownerId,
  });
  if (!accessible || accessible.state !== 'ACTIVE')
    throw new HttpError(404, 'NOT_FOUND', 'Rapport niet gevonden.');
  if (
    !['privacy', 'misleading', 'spam', 'other'].includes(
      String(input.category),
    ) ||
    typeof input.description !== 'string' ||
    input.description.trim().length < 10 ||
    input.description.length > 2000
  )
    throw new HttpError(
      400,
      'INVALID_ABUSE_REPORT',
      'Kies een reden en beschrijf die in 10 tot 2000 tekens.',
    );
  const existing = await env.DB.prepare(
    'SELECT id FROM abuse_reports WHERE publication_id=? AND reporter_id=?',
  )
    .bind(id, ownerId)
    .first();
  if (existing) return { accepted: true };
  await verifyChallenge(env, request, {
    action: 'abuse',
    ownerId,
    challengeId: input.challengeId,
    token: input.challengeToken,
  });
  await env.DB.prepare(
    'INSERT INTO abuse_reports(id,publication_id,reporter_id,category,description,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(publication_id,reporter_id) DO NOTHING',
  )
    .bind(
      crypto.randomUUID(),
      id,
      ownerId,
      input.category,
      input.description.trim(),
      Date.now(),
    )
    .run();
  return { accepted: true };
}

/**
 * Hide a snapshot or dismiss reports against its current revision.
 * @param env - Database and explicit moderator allowlist.
 * @param moderatorId - Authenticated account checked against that allowlist.
 * @param id - Publication being reviewed.
 * @param input - Untrusted action, revision and required justification.
 * @returns The recorded moderation action.
 * @throws HttpError for unauthorized access, invalid input or a revision conflict.
 */
export async function moderatePublication(
  env: RuntimeEnv,
  moderatorId: string,
  id: string,
  input: Record<string, unknown>,
) {
  assertModerator(env, moderatorId);
  if (
    !['hide', 'dismiss'].includes(String(input.action)) ||
    typeof input.reason !== 'string' ||
    input.reason.trim().length < 10 ||
    input.reason.length > 2000 ||
    !Number.isSafeInteger(input.revision)
  )
    throw new HttpError(
      400,
      'INVALID_MODERATION',
      'Een actuele revisie en duidelijke reden zijn verplicht.',
    );
  if (input.action === 'dismiss') {
    const eventId = crypto.randomUUID();
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO moderation_events(id,publication_id,moderator_id,action,reason,created_at) SELECT ?,id,?,'dismiss',?,? FROM publications WHERE id=? AND revision=?",
      ).bind(
        eventId,
        moderatorId,
        input.reason.trim(),
        Date.now(),
        id,
        input.revision,
      ),
      env.DB.prepare(
        "UPDATE abuse_reports SET state='REVIEWED' WHERE publication_id=? AND EXISTS(SELECT 1 FROM moderation_events WHERE id=?)",
      ).bind(id, eventId),
    ]);
    if (!results[0]?.meta.changes)
      throw new HttpError(
        409,
        'REVISION_CONFLICT',
        'Het rapport is gewijzigd. Vernieuw de pagina.',
      );
    return { dismissed: true };
  }
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE publications SET state='HIDDEN_BY_MODERATION',moderation_reason=?,revision=revision+1 WHERE id=? AND revision=? AND state='ACTIVE'",
    ).bind(input.reason.trim(), id, input.revision),
    env.DB.prepare(
      "INSERT INTO erasure_log(id,entity_type,entity_id,action,revision,created_at) SELECT ?,'publication',id,'revoke',revision,? FROM publications WHERE id=? AND revision=? AND state='HIDDEN_BY_MODERATION' AND changes()=1",
    ).bind(crypto.randomUUID(), Date.now(), id, (input.revision as number) + 1),
    env.DB.prepare(
      "INSERT INTO moderation_events(id,publication_id,moderator_id,action,reason,created_at) SELECT ?,id,?,'hide',?,? FROM publications WHERE id=? AND state='HIDDEN_BY_MODERATION' AND revision=? AND changes()=1",
    ).bind(
      crypto.randomUUID(),
      moderatorId,
      input.reason.trim(),
      Date.now(),
      id,
      (input.revision as number) + 1,
    ),
    env.DB.prepare(
      "UPDATE abuse_reports SET state='REVIEWED' WHERE publication_id=? AND EXISTS(SELECT 1 FROM publications WHERE id=? AND state='HIDDEN_BY_MODERATION')",
    ).bind(id, id),
  ]);
  if (!results[0]?.meta.changes)
    throw new HttpError(
      409,
      'REVISION_CONFLICT',
      'Het rapport is gewijzigd of al ingetrokken.',
    );
  return { hidden: true };
}

function assertModerator(env: RuntimeEnv, userId: string): void {
  if (!isModerator(env, userId)) {
    throw new HttpError(403, 'FORBIDDEN', 'Geen moderatietoegang.');
  }
}

/**
 * Check membership in the configured moderator allowlist.
 * @param env - Runtime configuration; an absent allowlist grants no access.
 * @param userId - Authenticated account ID.
 * @returns Whether the exact account ID is allowed to moderate.
 */
export function isModerator(env: RuntimeEnv, userId: string): boolean {
  return Boolean(
    env.MODERATOR_USER_IDS?.split(',')
      .map((id) => id.trim())
      .includes(userId),
  );
}

/**
 * Read up to 100 open abuse reports after checking moderator access.
 * @param env - Database and moderator allowlist.
 * @param userId - Authenticated moderator candidate.
 * @returns Oldest open reports first, with publication metadata but no body.
 */
export async function listModerationQueue(env: RuntimeEnv, userId: string) {
  assertModerator(env, userId);
  const rows = await env.DB.prepare(
    `SELECT a.id,a.publication_id AS publicationId,a.category,a.description,a.created_at AS createdAt,
    p.origin,p.visibility,p.state,p.revision FROM abuse_reports a JOIN publications p ON p.id=a.publication_id
    WHERE a.state='OPEN' ORDER BY a.created_at ASC LIMIT 100`,
  ).all<ModerationItem>();
  return rows.results;
}

/**
 * Read a snapshot for moderation, including nonpublic or hidden reports.
 * @param env - Database and moderator allowlist.
 * @param userId - Authenticated account whose moderation access is checked first.
 * @param id - Publication identifier.
 * @returns Moderation detail or null if the identifier is invalid or missing.
 */
export async function getModerationPublication(
  env: RuntimeEnv,
  userId: string,
  id: string,
): Promise<PublicationDetail | null> {
  assertModerator(env, userId);
  if (!/^[a-f0-9-]{36}$/iu.test(id)) return null;
  const row = await env.DB.prepare('SELECT * FROM publications WHERE id=?')
    .bind(id)
    .first<PublicationRow>();
  if (!row) return null;
  return {
    ...summarize(row),
    report: JSON.parse(row.report_json) as AuditReport | null,
    moderationReason: row.moderation_reason,
  };
}
