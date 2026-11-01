import { handleAccount } from './api-account';
import { handleChallenge } from './api-challenge';
import { handleIntent } from './api-intent';

import { requireUser } from './auth';

import { assertConfigured, HttpError, type RuntimeEnv } from './types';

import { assertMutation, rateLimit } from './security';

import { handleAuth } from './api-auth';
import { handlePublication } from './api-publication';
import { json } from './api-response';
import { listModerationQueue, listSites } from './publications';

/** Apply canonical-path, origin and rate controls before routing; return sanitized structured failures. */
export async function handleApi(
  request: Request,
  env: RuntimeEnv,
): Promise<Response> {
  try {
    assertConfigured(env, request);
    const url = new URL(request.url);
    if (/%|\\|\/{2,}/u.test(url.pathname))
      throw new HttpError(
        400,
        'NON_CANONICAL_PATH',
        'Gebruik een canoniek endpointpad.',
      );
    const path = url.pathname.replace(/\/$/u, '');
    const read = request.method === 'GET' || request.method === 'HEAD';
    await rateLimit(request, env, read ? 'read' : 'write', undefined, read);
    if (!read) assertMutation(request, env);

    if (path.startsWith('/api/auth/')) {
      return await handleAuth(request, path, read, env);
    }
    if (path === '/api/index' && read) return json(await readIndex(env, url));
    const handleAccountResult = await handleAccount(request, env, path);
    if (handleAccountResult) return handleAccountResult;
    if (path === '/api/moderation' && read) {
      const user = await requireUser(request, env);
      return json({ items: await listModerationQueue(env, user.id) });
    }
    const handleChallengeResult = await handleChallenge(request, env, path);
    if (handleChallengeResult) return handleChallengeResult;
    const handleIntentResult = await handleIntent(
      request,
      env,
      path,
      url,
      read,
    );
    if (handleIntentResult) return handleIntentResult;
    const reportMatch = path.match(
      /^\/api\/publications\/([a-f0-9-]{36})(?:\/(abuse|moderate|export))?$/iu,
    );
    if (reportMatch) {
      const result = await handlePublication(
        request,
        env,
        reportMatch,
        url,
        read,
      );
      if (result) return result;
    }
    throw new HttpError(404, 'NOT_FOUND', 'Endpoint niet gevonden.');
  } catch (error) {
    if (error instanceof HttpError) {
      const response = json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
      if (error.status === 429 || error.code === 'UPLOADS_PAUSED')
        response.headers.set('Retry-After', '60');
      return response;
    }
    // Do not log report bodies, tokens, addresses, passwords or raw database errors.
    console.error('epi-less API request failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message:
            'Dit verzoek kon niet worden verwerkt. Probeer later opnieuw.',
        },
      },
      500,
    );
  }
}

async function readIndex(env: RuntimeEnv, url: URL) {
  return listSites(env, {
    query: url.searchParams.get('q') || undefined,
    cursor: url.searchParams.get('cursor') || undefined,
    status: url.searchParams.get('status') || undefined,
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined,
    criterion: url.searchParams.get('criterion') || undefined,
  });
}
