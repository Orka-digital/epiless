import {
  pruneChallenges,
  insertChallenge,
  consumeChallenge,
} from './db/challenges';
import {
  HttpError,
  isLocalFixture,
  assertConfigured,
  type RuntimeEnv,
} from './types';

export const MAX_BODY = 1_048_576;
const localLimits = new Map<string, { count: number; reset: number }>();

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function shareToken(
  env: RuntimeEnv,
  publicationId: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SHARE_TOKEN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`flashguard-share-v1:${publicationId}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function assertMutation(request: Request, env: RuntimeEnv): void {
  assertConfigured(env, request);
  if (
    !['POST', 'PATCH', 'DELETE'].includes(request.method) ||
    request.headers.get('origin') !== new URL(env.PUBLIC_APP_ORIGIN).origin
  ) {
    throw new HttpError(
      403,
      'ORIGIN_REQUIRED',
      'Deze handeling moet op de officiële website starten.',
    );
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')
    throw new HttpError(
      403,
      'CROSS_SITE_REQUEST',
      'Verzoek van een andere site geweigerd.',
    );
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new HttpError(415, 'JSON_REQUIRED', 'Verstuur JSON.');
}

export async function readJson(
  request: Pick<Request, 'headers' | 'body'>,
  maxBytes = MAX_BODY + 16_384,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') || '0');
  if (declared > maxBytes)
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Dit rapport is te groot.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'EMPTY_BODY', 'De inhoud ontbreekt.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Dit rapport is te groot.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const result: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    if (!result || Array.isArray(result) || typeof result !== 'object')
      throw new Error('object required');
    return result as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'De JSON-inhoud is ongeldig.');
  }
}

export async function rateLimit(
  request: Request,
  env: RuntimeEnv,
  action: string,
  actor?: string,
  read = false,
): Promise<void> {
  const network = request.headers.get('cf-connecting-ip') || 'local';
  const key = `${action}:${await sha256(`${env.SHARE_TOKEN_SECRET}:${actor || network}`)}`;
  const binding = read ? env.READ_RATE_LIMITER : env.WRITE_RATE_LIMITER;
  if (binding) {
    if (!(await binding.limit({ key })).success)
      throw new HttpError(
        429,
        'RATE_LIMITED',
        'Te veel verzoeken. Probeer het over een minuut opnieuw.',
      );
    return;
  }
  if (env.ENVIRONMENT !== 'development')
    throw new HttpError(
      503,
      'LIMITER_UNAVAILABLE',
      'Misbruikbescherming is tijdelijk niet beschikbaar.',
    );
  const now = Date.now();
  if (localLimits.size > 2000)
    for (const [entry, value] of localLimits)
      if (value.reset < now) localLimits.delete(entry);
  const current = localLimits.get(key);
  const state =
    current && current.reset > now
      ? current
      : { count: 0, reset: now + 60_000 };
  state.count++;
  localLimits.set(key, state);
  if (state.count > (read ? 120 : 20))
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Te veel verzoeken. Probeer het over een minuut opnieuw.',
    );
}

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
