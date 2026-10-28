import {
  findAbuseReport,
  insertAbuseReport,
  openModerationQueue,
} from './db/moderation-reads';
import { storedPublication } from './db/publication-reads';
import { dismissReports, hidePublication } from './db/moderation-writes';
import { type AuditReport } from '@epi-less/core';
import { summarize } from './publication-presentation';
import { getPublication } from './publication-queries';
import { type PublicationDetail } from './publication-types';
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
  const existing = await findAbuseReport(env, id, ownerId);
  if (existing) return { accepted: true };
  await verifyChallenge(env, request, {
    action: 'abuse',
    ownerId,
    challengeId: input.challengeId,
    token: input.challengeToken,
  });
  await insertAbuseReport(env, {
    id: crypto.randomUUID(),
    publication_id: id,
    reporter_id: ownerId,
    category: String(input.category),
    description: input.description.trim(),
    created_at: Date.now(),
  });
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
    const changes = await dismissReports(
      env,
      moderatorId,
      id,
      input.revision as number,
      input.reason.trim(),
    );
    if (!changes)
      throw new HttpError(
        409,
        'REVISION_CONFLICT',
        'Het rapport is gewijzigd. Vernieuw de pagina.',
      );
    return { dismissed: true };
  }
  const changes = await hidePublication(
    env,
    moderatorId,
    id,
    input.revision as number,
    input.reason.trim(),
  );
  if (!changes)
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
  return openModerationQueue(env);
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
  const row = await storedPublication(env, id);
  if (!row) return null;
  return {
    ...summarize(row),
    report: JSON.parse(row.report_json) as AuditReport | null,
    moderationReason: row.moderation_reason,
  };
}
