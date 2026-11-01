import { requireUser } from './auth';

import { HttpError, type RuntimeEnv } from './types';

import { createChallenge, rateLimit, readJson } from './security';

import { json } from './api-response';

/** Handle the scoped endpoint after shared origin and rate checks; undefined leaves routing to the caller. */
export async function handleChallenge(
  request: Request,
  env: RuntimeEnv,
  path: string,
): Promise<Response | undefined> {
  if (path === '/api/security/challenge' && request.method === 'POST') {
    const input = await readJson(request, 4096);
    if (input.action === 'auth')
      return json(await createChallenge(env, request, 'auth'));
    const user = await requireUser(request, env);
    await rateLimit(request, env, 'challenge-account', user.id);
    if (input.action === 'abuse')
      return json(await createChallenge(env, request, 'abuse', user.id));
    throw new HttpError(
      400,
      'INVALID_ACTION',
      'Begin een publicatie via de rapportpreview.',
    );
  }
}
