import { contentHash, stableJson } from '@epi-less/core';

import { assertPublicOrigin } from './public-origin';

import { assertUploadsAvailable } from './publication-mutations';

import { parseVisibility } from './publication-presentation';

import { getPublication } from './publication-queries';

import { databaseErrorIncludes } from './db/client';

import {
  cancelStoredIntent,
  expireIntents,
  findIntent,
  grantIntent,
  insertIntent,
  renewIntent,
} from './db/intents';

import { createChallenge, MAX_BODY, verifyChallenge } from './security';

import {
  assertReusableIntent,
  validatedIntentReport,
} from './intent-validation';
import { HttpError, type RuntimeEnv } from './types';

/**
 * Validate and freeze a user-approved report before publication.
 *
 * Reusing an idempotency key is allowed only for the same content and visibility.
 * Expired pending snapshots are cleared; database constraints arbitrate races.
 * @param env - Database, upload policy and challenge bindings.
 * @param request - Incoming request used to bind the anti-abuse challenge.
 * @param ownerId - Authenticated account creating the snapshot.
 * @param input - Untrusted report, visibility, content hash and idempotency key.
 * @returns The existing publication or an intent and its verification challenge.
 * @throws HttpError when validation, quotas or snapshot identity reject the request.
 */
export async function createIntent(
  env: RuntimeEnv,
  request: Request,
  ownerId: string,
  input: Record<string, unknown>,
) {
  if (
    typeof input.idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(input.idempotencyKey)
  )
    throw new HttpError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Een geldige opdrachtsleutel is verplicht.',
    );
  const visibility = parseVisibility(input.visibility);
  const report = validatedIntentReport(input.report);
  if (visibility === 'PUBLIC') assertPublicOrigin(report.origin);
  const json = stableJson(report);
  const size = new TextEncoder().encode(json).length;
  if (size > MAX_BODY)
    throw new HttpError(
      413,
      'REPORT_TOO_LARGE',
      'Het rapport mag maximaal 1 MiB groot zijn.',
    );
  const hash = await contentHash(report);
  if (input.contentHash !== undefined && input.contentHash !== hash)
    throw new HttpError(
      409,
      'SNAPSHOT_CHANGED',
      'Het rapport veranderde na de preview. Controleer het opnieuw.',
    );
  const now = Date.now();
  await expireIntents(env, ownerId, now);
  const existing = await findIntent(env, ownerId, {
    idempotencyKey: input.idempotencyKey,
  });
  if (existing) {
    assertReusableIntent(existing, hash, visibility);
    if (existing.state === 'CONSUMED')
      return {
        id: existing.id,
        contentHash: hash,
        state: existing.state,
        publication: await getPublication(env, {
          id: existing.id,
          userId: ownerId,
        }),
      };
    assertUploadsAvailable(env);
    if (existing.expires_at < now || existing.state === 'EXPIRED') {
      let renewed: D1Result;
      try {
        renewed = await renewIntent(
          env,
          ownerId,
          existing.id,
          json,
          now + 10 * 60_000,
        );
      } catch (error) {
        if (databaseErrorIncludes(error, 'PENDING_QUOTA'))
          throw new HttpError(
            429,
            'PENDING_QUOTA',
            'Er staan al drie opdrachten open. Rond die af of annuleer een opdracht.',
          );
        throw error;
      }
      if (!renewed.meta.changes)
        throw new HttpError(
          409,
          'INTENT_CHANGED',
          'De opdracht is inmiddels gewijzigd.',
        );
      existing.state = 'PENDING';
    }
    return {
      id: existing.id,
      contentHash: hash,
      state: existing.state,
      challenge:
        existing.state === 'VERIFIED'
          ? null
          : await createChallenge(
              env,
              request,
              'publish',
              ownerId,
              existing.id,
            ),
    };
  }
  assertUploadsAvailable(env);
  const id = crypto.randomUUID();
  try {
    await insertIntent(env, {
      id,
      owner_id: ownerId,
      idempotency_key: input.idempotencyKey,
      content_hash: hash,
      visibility,
      report_json: json,
      size_bytes: size,
      origin: report.origin,
      status: report.status,
      route_count: report.routes.length,
      created_at: now,
      expires_at: now + 10 * 60_000,
    });
  } catch (error) {
    if (
      databaseErrorIncludes(error, 'PENDING_QUOTA') ||
      databaseErrorIncludes(error, 'UNIQUE')
    ) {
      const wonRace = await findIntent(env, ownerId, {
        idempotencyKey: input.idempotencyKey,
      });
      if (wonRace) return createIntent(env, request, ownerId, input);
    }
    if (databaseErrorIncludes(error, 'PENDING_QUOTA'))
      throw new HttpError(
        429,
        'PENDING_QUOTA',
        'Er staan al drie opdrachten open. Rond die af of wacht tien minuten.',
      );
    throw error;
  }
  return {
    id,
    contentHash: hash,
    state: 'PENDING',
    challenge: await createChallenge(env, request, 'publish', ownerId, id),
  };
}

/**
 * Grant a short-lived publication permission for an owned, unchanged intent.
 * @param env - Database and challenge verification bindings.
 * @param request - Request whose challenge token must be verified.
 * @param ownerId - Authenticated account; never taken from the request body.
 * @param id - Intent identifier scoped to that owner.
 * @param input - Untrusted challenge identifier and token.
 * @returns VERIFIED, or the existing publication if the intent was consumed.
 * @throws HttpError for missing, canceled, expired or concurrently changed intents.
 */
export async function verifyIntent(
  env: RuntimeEnv,
  request: Request,
  ownerId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const intent = await findIntent(env, ownerId, { id });
  if (!intent) throw new HttpError(404, 'NOT_FOUND', 'Opdracht niet gevonden.');
  if (intent.canceled_at !== null)
    throw new HttpError(
      409,
      'INTENT_CANCELLED',
      'Deze opdracht is geannuleerd.',
    );
  if (intent.state === 'CONSUMED')
    return {
      state: 'CONSUMED',
      publication: await getPublication(env, { id, userId: ownerId }),
    };
  if (intent.expires_at < Date.now())
    throw new HttpError(409, 'INTENT_EXPIRED', 'Deze opdracht is verlopen.');
  if (intent.state === 'VERIFIED' && (intent.verified_until || 0) >= Date.now())
    return { state: 'VERIFIED' };
  await verifyChallenge(env, request, {
    challengeId: input.challengeId,
    token: input.token,
    action: 'publish',
    ownerId,
    intentId: id,
  });
  const result = await grantIntent(
    env,
    ownerId,
    id,
    Math.min(intent.expires_at, Date.now() + 10 * 60_000),
    Date.now(),
  );
  if (!result.meta.changes)
    throw new HttpError(
      409,
      'INTENT_CHANGED',
      'De opdracht is inmiddels gewijzigd.',
    );
  return { state: 'VERIFIED' };
}

/** Cancellation and commit race on the same row; a committed report is never undone. */
export async function cancelIntent(
  env: RuntimeEnv,
  ownerId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const intent = await findIntent(env, ownerId, { id });
  if (!intent) throw new HttpError(404, 'NOT_FOUND', 'Opdracht niet gevonden.');
  if (input.contentHash !== intent.content_hash)
    throw new HttpError(
      409,
      'SNAPSHOT_CHANGED',
      'Deze annulering hoort bij een andere snapshot.',
    );
  await cancelStoredIntent(env, ownerId, id, Date.now());
  const current = await findIntent(env, ownerId, { id });
  if (current?.state === 'CONSUMED')
    return {
      state: 'CONSUMED',
      publication: await getPublication(env, { id, userId: ownerId }),
    };
  return { state: 'CANCELLED', canceled: true };
}
