import { assertConfigured, HttpError, type RuntimeEnv } from './types';

export const MAX_BODY = 1_048_576;

const localLimits = new Map<string, { count: number; reset: number }>();

/** Hash UTF-8 text to lowercase SHA-256 hex; no source text is retained. */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Derive the publication share capability with the server HMAC secret. */
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

/** Require configured same-origin JSON mutation requests before processing their bodies. */
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

/** Read bounded UTF-8 JSON object input; cancel oversized streams and reject malformed bodies. */
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

/** Enforce the bound limiter; production fails closed when abuse protection is unavailable. */
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
export { createChallenge, verifyChallenge } from './challenge-security';
