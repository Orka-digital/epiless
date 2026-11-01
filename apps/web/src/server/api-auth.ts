import { createAuth } from './auth';

import { HttpError, type RuntimeEnv } from './types';

import { rateLimit, readJson, verifyChallenge } from './security';

/** Route only supported authentication paths after mutation and challenge checks. */
export async function handleAuth(
  request: Request,
  path: string,
  read: boolean,
  env: RuntimeEnv,
) {
  if (request.method !== 'GET' && request.method !== 'POST')
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Gebruik GET of POST.');
  const authPath = path.slice('/api/auth'.length);
  const resetCallback =
    request.method === 'GET' &&
    /^\/reset-password\/[A-Za-z0-9_-]{16,256}$/u.test(authPath);
  if (
    !resetCallback &&
    ![
      '/sign-up/email',
      '/sign-in/email',
      '/sign-out',
      '/get-session',
      '/request-password-reset',
      '/reset-password',
      '/send-verification-email',
      '/verify-email',
    ].includes(authPath)
  ) {
    throw new HttpError(404, 'NOT_FOUND', 'Endpoint niet gevonden.');
  }
  if (!read) {
    await validateAuthMutation(request, env, authPath);
  }
  return createAuth(env).handler(request);
}

async function validateAuthMutation(
  request: Request,
  env: RuntimeEnv,
  authPath: string,
) {
  // Parse a clone before expensive password work; Better Auth consumes the original.
  const authInput = await readJson(request.clone(), 16384);
  if (
    authPath === '/sign-up/email' &&
    (typeof authInput.name !== 'string' ||
      authInput.name.trim().length < 2 ||
      authInput.name.length > 60)
  ) {
    throw new HttpError(
      400,
      'PROFILE_INVALID',
      'Kies een openbare naam van 2 tot 60 tekens.',
    );
  }
  if (typeof authInput.email === 'string' && authInput.email.length > 254) {
    throw new HttpError(400, 'PROFILE_INVALID', 'Dit e-mailadres is te lang.');
  }
  if (
    [
      '/sign-up/email',
      '/sign-in/email',
      '/request-password-reset',
      '/send-verification-email',
    ].includes(authPath)
  ) {
    if (typeof authInput.email === 'string')
      await rateLimit(
        request,
        env,
        'auth-target',
        authInput.email.trim().toLowerCase(),
      );
    if (
      env.ENVIRONMENT === 'production' &&
      (!env.RESEND_API_KEY || !env.MAIL_FROM)
    )
      throw new HttpError(
        503,
        'MAIL_UNAVAILABLE',
        'Accountbeheer is nog niet volledig ingesteld.',
      );
    await verifyChallenge(env, request, {
      action: 'auth',
      challengeId: request.headers.get('x-flashguard-challenge'),
      token: request.headers.get('x-captcha-response'),
    });
  }
}
