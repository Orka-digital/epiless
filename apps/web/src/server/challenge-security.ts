import {
  consumeChallenge,
  insertChallenge,
  pruneChallenges,
} from './db/challenges';

import { HttpError, isLocalFixture, type RuntimeEnv } from './types';

/** Persist a short-lived action-bound challenge before returning its public widget data. */
export async function createChallenge(
  env: RuntimeEnv,
  request: Request,
  action: 'auth' | 'publish' | 'abuse',
  ownerId?: string,
  intentId?: string,
) {
  const now = Date.now();
  const id = crypto.randomUUID();
  const cdata = crypto.randomUUID().replaceAll('-', '');
  await pruneChallenges(env, now - 60_000);
  await insertChallenge(env, {
    id,
    action,
    owner_id: ownerId || null,
    intent_id: intentId || null,
    cdata,
    created_at: now,
    expires_at: now + 5 * 60_000,
    verify_key: crypto.randomUUID(),
  });
  return {
    id,
    action,
    cdata,
    siteKey: env.TURNSTILE_SITE_KEY,
    local: isLocalFixture(env, request),
    expiresAt: now + 5 * 60_000,
  };
}

/** Consume a challenge once and verify provider action, hostname and cdata; reject unavailable protection. */
export async function verifyChallenge(
  env: RuntimeEnv,
  request: Request,
  args: {
    challengeId: unknown;
    token: unknown;
    action: 'auth' | 'publish' | 'abuse';
    ownerId?: string;
    intentId?: string;
  },
  fetcher: typeof fetch = fetch,
) {
  if (
    typeof args.challengeId !== 'string' ||
    typeof args.token !== 'string' ||
    !args.token ||
    args.token.length > 2048
  )
    throw new HttpError(
      400,
      'CHALLENGE_REQUIRED',
      'Voltooi de verificatie opnieuw.',
    );
  const row = await consumeChallenge(
    env,
    args.challengeId,
    args.action,
    args.ownerId,
    args.intentId,
  );
  if (!row)
    throw new HttpError(
      403,
      'CHALLENGE_EXPIRED',
      'Deze verificatie is verlopen of al gebruikt.',
    );
  if (isLocalFixture(env, request) && args.token === 'flashguard-local-test')
    return;
  const allowed = configuredHosts(env);
  let result: {
    success?: boolean;
    hostname?: string;
    action?: string;
    cdata?: string;
  };
  try {
    const response = await fetcher(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: args.token,
          remoteip: request.headers.get('cf-connecting-ip') || undefined,
          idempotency_key: row.verify_key,
        }),
      },
    );
    if (!response.ok) throw new Error('provider unavailable');
    result = await response.json();
  } catch {
    throw new HttpError(
      503,
      'VERIFICATION_UNAVAILABLE',
      'Verificatie is tijdelijk niet beschikbaar. Probeer later opnieuw.',
    );
  }
  if (
    !result.success ||
    !result.hostname ||
    !allowed.includes(result.hostname) ||
    result.action !== row.action ||
    result.cdata !== row.cdata
  )
    throw new HttpError(
      403,
      'CHALLENGE_REJECTED',
      'Verificatie geweigerd. Probeer opnieuw.',
    );
}

function configuredHosts(env: RuntimeEnv) {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_HOSTNAMES)
    throw new HttpError(
      503,
      'VERIFICATION_UNAVAILABLE',
      'Verificatie is nog niet ingesteld.',
    );
  if (
    env.ENVIRONMENT === 'production' &&
    (/^[123]x0{10,}/u.test(env.TURNSTILE_SECRET_KEY) ||
      /^[123]x0{10,}/u.test(env.TURNSTILE_SITE_KEY))
  ) {
    throw new HttpError(
      503,
      'VERIFICATION_UNAVAILABLE',
      'Testkeys zijn niet toegestaan in productie.',
    );
  }
  const allowed = env.TURNSTILE_HOSTNAMES.split(',').map((host) => host.trim());
  if (
    env.ENVIRONMENT === 'production' &&
    allowed.some((host) => ['localhost', '127.0.0.1', '[::1]'].includes(host))
  )
    throw new HttpError(
      503,
      'VERIFICATION_UNAVAILABLE',
      'Ongeldige productiehostnames.',
    );
  return allowed;
}
