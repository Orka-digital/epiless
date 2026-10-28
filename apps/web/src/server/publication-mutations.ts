import { intentHeader } from './db/intents';
import { ownedPublication } from './db/publication-reads';
import {
  insertPublicationSnapshot,
  mutatePublication,
} from './db/publication-writes';
import { assertPublicOrigin, isPublicOrigin } from './public-origin';
import { parseVisibility } from './publication-presentation';
import { getPublication } from './publication-queries';
import { type PublicationDetail } from './publication-types';
import { sha256, shareToken } from './security';
import { HttpError, type RuntimeEnv } from './types';

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
  const owned = await intentHeader(env, ownerId, intentId);
  if (!owned) throw new HttpError(404, 'NOT_FOUND', 'Opdracht niet gevonden.');
  if (existing) return existing;
  assertUploadsAvailable(env);
  if (owned.visibility === 'PUBLIC') assertPublicOrigin(owned.origin);
  const now = Date.now();
  const tokenHash = await sha256(await shareToken(env, `${intentId}:1`));
  try {
    await insertPublicationSnapshot(
      env,
      ownerId,
      intentId,
      tokenHash,
      now,
      isPublicOrigin(owned.origin) ? 1 : 0,
    );
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
  const action = input.action;
  if (
    action !== 'revoke' &&
    action !== 'delete' &&
    action !== 'visibility' &&
    action !== 'rotate-link'
  )
    throw new HttpError(400, 'INVALID_ACTION', 'Onbekende rapportactie.');
  let access;
  if (action === 'visibility' || action === 'rotate-link') {
    const visibility =
      action === 'rotate-link' ? 'UNLISTED' : parseVisibility(input.visibility);
    const scope = await ownedPublication(env, id, ownerId);
    if (!scope) throw new HttpError(404, 'NOT_FOUND', 'Rapport niet gevonden.');
    if (visibility === 'PUBLIC') assertPublicOrigin(scope.origin);
    const version = (input.revision as number) + 1;
    const tokenHash = await sha256(await shareToken(env, `${id}:${version}`));
    access = {
      visibility,
      tokenHash,
      originAllowed: isPublicOrigin(scope.origin) ? 1 : 0,
    };
  }
  const result = await mutatePublication(
    env,
    ownerId,
    id,
    input.revision as number,
    action,
    access,
  );
  if (!result?.meta.changes) {
    const owner = await ownedPublication(env, id, ownerId);
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
