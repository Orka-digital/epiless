import { assertPublicOrigin, isPublicOrigin } from './public-origin';
import { parseVisibility } from './publication-presentation';
import { getPublication } from './publication-queries';
import { type PublicationDetail } from './publication-types';
import { sha256, shareToken } from './security';
import { HttpError, type RuntimeEnv, type Visibility } from './types';

/**
 * Atomically consume a verified intent and publish its immutable snapshot.
 *
 * Retries return the existing owned publication. SQL constraints and triggers keep
 * verification, expiry and quota checks attached to the insert.
 * @param env - Database, signing secret and upload policy bindings.
 * @param ownerId - Authenticated owner of the verified intent.
 * @param intentId - Untrusted identifier; validated before querying.
 * @returns The committed publication, including owner-only details.
 * @throws HttpError if ownership, verification, quota or origin policy fails.
 */
export async function commitPublication(
  env: RuntimeEnv,
  ownerId: string,
  intentId: unknown,
): Promise<PublicationDetail> {
  if (typeof intentId !== 'string')
    throw new HttpError(
      400,
      'INTENT_REQUIRED',
      'De publicatieopdracht ontbreekt.',
    );
  const existing = await getPublication(env, { id: intentId, userId: ownerId });
  const owned = await env.DB.prepare(
    'SELECT id,origin,visibility FROM publication_intents WHERE id=? AND owner_id=?',
  )
    .bind(intentId, ownerId)
    .first<{ id: string; origin: string; visibility: Visibility }>();
  if (!owned) throw new HttpError(404, 'NOT_FOUND', 'Opdracht niet gevonden.');
  if (existing) return existing;
  assertUploadsAvailable(env);
  if (owned.visibility === 'PUBLIC') assertPublicOrigin(owned.origin);
  const now = Date.now();
  const tokenHash = await sha256(await shareToken(env, `${intentId}:1`));
  try {
    await env.DB.prepare(
      `INSERT INTO publications(id,intent_id,owner_id,author_name,content_hash,visibility,report_json,origin,status,route_count,size_bytes,token_hash,published_at,public_origin_allowed)
      SELECT id,id,owner_id,(SELECT name FROM user WHERE id=owner_id),content_hash,visibility,report_json,origin,status,route_count,size_bytes,?,?,? FROM publication_intents
      WHERE id=? AND owner_id=? AND state='VERIFIED' AND canceled_at IS NULL AND expires_at>=? AND verified_until>=? ON CONFLICT(intent_id) DO NOTHING`,
    )
      .bind(
        tokenHash,
        now,
        isPublicOrigin(owned.origin) ? 1 : 0,
        intentId,
        ownerId,
        now,
        now,
      )
      .run();
  } catch (error) {
    if (String(error).includes('QUOTA'))
      throw new HttpError(
        429,
        'ACCOUNT_QUOTA',
        'Je daglimiet (10 rapporten) of opslaglimiet (25 MiB) is bereikt.',
      );
    if (String(error).includes('GRANT_INVALID'))
      throw new HttpError(
        403,
        'GRANT_INVALID',
        'Verifieer deze opdracht opnieuw.',
      );
    throw error;
  }
  const result = await getPublication(env, { id: intentId, userId: ownerId });
  if (!result)
    throw new HttpError(
      403,
      'VERIFICATION_REQUIRED',
      'Verifieer de publicatie eerst.',
    );
  return result;
}

/**
 * Apply an owner mutation only to the explicitly reviewed revision.
 *
 * Visibility changes and link rotation regenerate tokens; revocation and deletion
 * append an erasure record in the same database batch.
 * @param env - Database and share-token bindings.
 * @param ownerId - Authenticated account performing the mutation.
 * @param id - Publication identifier scoped to the owner.
 * @param input - Untrusted action, revision and optional visibility.
 * @returns The updated owner detail.
 * @throws HttpError for invalid actions or stale revisions.
 */
export async function updatePublication(
  env: RuntimeEnv,
  ownerId: string,
  id: string,
  input: Record<string, unknown>,
) {
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1)
    throw new HttpError(
      400,
      'REVISION_REQUIRED',
      'De actuele rapportrevisie ontbreekt.',
    );
  let statement: D1PreparedStatement;
  if (input.action === 'revoke') {
    statement = env.DB.prepare(
      "UPDATE publications SET state='REVOKED',revision=revision+1,revoked_at=? WHERE id=? AND owner_id=? AND revision=? AND state!='REVOKED'",
    ).bind(Date.now(), id, ownerId, input.revision);
  } else if (input.action === 'delete') {
    statement = env.DB.prepare(
      "UPDATE publications SET state='REVOKED',visibility='PRIVATE',report_json='null',size_bytes=0,origin='https://deleted.invalid',author_name='Verwijderd',route_count=0,status='ERROR',audited_at=0,discovered_count=0,measured_count=0,scenario_count=0,candidate_count=0,engine_version='',stop_reason='',revision=revision+1,revoked_at=? WHERE id=? AND owner_id=? AND revision=? AND size_bytes>0",
    ).bind(Date.now(), id, ownerId, input.revision);
  } else if (input.action === 'visibility' || input.action === 'rotate-link') {
    const visibility =
      input.action === 'rotate-link'
        ? 'UNLISTED'
        : parseVisibility(input.visibility);
    const scope = await env.DB.prepare(
      'SELECT origin FROM publications WHERE id=? AND owner_id=?',
    )
      .bind(id, ownerId)
      .first<{ origin: string }>();
    if (!scope) throw new HttpError(404, 'NOT_FOUND', 'Rapport niet gevonden.');
    if (visibility === 'PUBLIC') assertPublicOrigin(scope.origin);
    const version = (input.revision as number) + 1;
    const tokenHash = await sha256(await shareToken(env, `${id}:${version}`));
    statement = env.DB.prepare(
      "UPDATE publications SET visibility=?,revision=revision+1,share_version=?,token_hash=?,public_origin_allowed=? WHERE id=? AND owner_id=? AND revision=? AND state='ACTIVE' AND (? != 'rotate-link' OR visibility='UNLISTED')",
    ).bind(
      visibility,
      version,
      tokenHash,
      isPublicOrigin(scope.origin) ? 1 : 0,
      id,
      ownerId,
      input.revision,
      input.action,
    );
  } else {
    throw new HttpError(400, 'INVALID_ACTION', 'Onbekende rapportactie.');
  }
  const [result] = await env.DB.batch([
    statement,
    env.DB.prepare(
      "INSERT INTO erasure_log(id,entity_type,entity_id,action,revision,created_at) SELECT ?,'publication',id,?,revision,? FROM publications WHERE id=? AND owner_id=? AND revision=? AND changes()=1",
    ).bind(
      crypto.randomUUID(),
      input.action,
      Date.now(),
      id,
      ownerId,
      (input.revision as number) + 1,
    ),
  ]);
  if (!result?.meta.changes) {
    const owner = await env.DB.prepare(
      'SELECT id FROM publications WHERE id=? AND owner_id=?',
    )
      .bind(id, ownerId)
      .first();
    if (!owner) throw new HttpError(404, 'NOT_FOUND', 'Rapport niet gevonden.');
    throw new HttpError(
      409,
      'REVISION_CONFLICT',
      'Het rapport is gewijzigd. Vernieuw de pagina en probeer opnieuw.',
    );
  }
  return getPublication(env, { id, userId: ownerId });
}

/**
 * Reject new upload work while the operational write-pause switch is enabled.
 */
export function assertUploadsAvailable(env: RuntimeEnv) {
  if (env.UPLOADS_PAUSED === 'true')
    throw new HttpError(
      503,
      'UPLOADS_PAUSED',
      'Online bewaren is tijdelijk gepauzeerd. Bestaande rapporten blijven beschikbaar; probeer later opnieuw.',
    );
}
