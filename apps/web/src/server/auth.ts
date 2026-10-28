import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { database } from './db/client';
import * as schema from './db/schema';
import { assertConfigured, HttpError, type RuntimeEnv } from './types';

async function sendEmail(
  env: RuntimeEnv,
  to: string,
  url: string,
  kind: 'verify' | 'reset',
) {
  if (env.ENVIRONMENT === 'development') return;
  if (!env.RESEND_API_KEY || !env.MAIL_FROM)
    throw new HttpError(
      503,
      'MAIL_UNAVAILABLE',
      'E-mail is nog niet ingesteld.',
    );
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject:
        kind === 'verify'
          ? 'Bevestig je epi-less-account'
          : 'Herstel je epi-less-wachtwoord',
      text: `${kind === 'verify' ? 'Bevestig je e-mailadres' : 'Kies een nieuw wachtwoord'} via deze link:\n${url}\n\nNiet aangevraagd? Je kunt dit bericht negeren.`,
    }),
  });
  if (!response.ok)
    throw new HttpError(
      503,
      'MAIL_UNAVAILABLE',
      'E-mail kon tijdelijk niet worden verzonden.',
    );
}

/** Configure authentication against the shared database schema and runtime secrets. */
export function createAuth(env: RuntimeEnv) {
  assertConfigured(env);
  const production = env.ENVIRONMENT === 'production';
  return betterAuth({
    appName: 'epi-less',
    baseURL: env.PUBLIC_APP_ORIGIN,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database(env), {
      provider: 'sqlite',
      schema,
    }),
    trustedOrigins: [env.PUBLIC_APP_ORIGIN],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: production,
      sendResetPassword: async ({ user, url }) =>
        sendEmail(env, user.email, url, 'reset'),
    },
    emailVerification: {
      sendOnSignUp: production,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        sendEmail(env, user.email, url, 'verify'),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      useSecureCookies: production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: production,
      },
    },
    rateLimit: { enabled: true, window: 60, max: 30 },
  });
}

/** Read the authenticated session from request headers without requiring sign-in. */
export async function getSession(request: Request, env: RuntimeEnv) {
  // Anonymous report/index requests need neither auth initialization nor a DB lookup.
  if (!request.headers.get('cookie')) return null;
  return createAuth(env).api.getSession({ headers: request.headers });
}

/** Require an authenticated account and, by default, verified email; reject missing authorization. */
export async function requireUser(
  request: Request,
  env: RuntimeEnv,
  options: { verified?: boolean } = { verified: true },
) {
  const session = await getSession(request, env);
  if (!session)
    throw new HttpError(
      401,
      'LOGIN_REQUIRED',
      'Meld je aan om verder te gaan.',
    );
  if (
    options.verified !== false &&
    env.ENVIRONMENT === 'production' &&
    !session.user.emailVerified
  )
    throw new HttpError(
      403,
      'EMAIL_UNVERIFIED',
      'Bevestig eerst je e-mailadres.',
    );
  return session.user;
}
