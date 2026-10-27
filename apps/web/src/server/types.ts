export interface RuntimeEnv {
  DB: D1Database;
  ENVIRONMENT: 'development' | 'production';
  PUBLIC_APP_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  SHARE_TOKEN_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
  LOCAL_TURNSTILE_FIXTURE?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  MODERATOR_USER_IDS?: string;
  UPLOADS_PAUSED?: string;
  WRITE_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  READ_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Visibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
export type PublicationState = 'ACTIVE' | 'REVOKED' | 'HIDDEN_BY_MODERATION';

export function assertConfigured(env: RuntimeEnv, request?: Request): void {
  if (
    !env.DB ||
    !env.PUBLIC_APP_ORIGIN ||
    !env.BETTER_AUTH_SECRET ||
    env.BETTER_AUTH_SECRET.length < 32 ||
    !env.SHARE_TOKEN_SECRET ||
    env.SHARE_TOKEN_SECRET.length < 32
  ) {
    throw new HttpError(
      503,
      'CONFIGURATION_REQUIRED',
      'De dienst is nog niet volledig geconfigureerd.',
    );
  }
  const origin = new URL(env.PUBLIC_APP_ORIGIN);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
    origin.hostname,
  );
  if (
    origin.origin !== env.PUBLIC_APP_ORIGIN ||
    (env.ENVIRONMENT === 'development' && !loopback)
  ) {
    throw new HttpError(
      503,
      'CONFIGURATION_REQUIRED',
      'Ontwikkelmodus is alleen toegestaan op localhost. Gebruik een canonieke origin zonder pad.',
    );
  }
  if (env.ENVIRONMENT !== 'development' && env.ENVIRONMENT !== 'production') {
    throw new HttpError(
      503,
      'CONFIGURATION_REQUIRED',
      'Een expliciete omgeving is verplicht.',
    );
  }
  if (
    env.ENVIRONMENT === 'production' &&
    (origin.protocol !== 'https:' ||
      loopback ||
      env.LOCAL_TURNSTILE_FIXTURE === 'true' ||
      !env.WRITE_RATE_LIMITER ||
      !env.READ_RATE_LIMITER)
  ) {
    throw new HttpError(
      503,
      'CONFIGURATION_REQUIRED',
      'Productiebeveiliging is onvolledig.',
    );
  }
  if (request && new URL(request.url).origin !== origin.origin) {
    throw new HttpError(403, 'ORIGIN_MISMATCH', 'Ongeldige dienstorigin.');
  }
}

export function isLocalFixture(env: RuntimeEnv, request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return (
    env.ENVIRONMENT === 'development' &&
    env.LOCAL_TURNSTILE_FIXTURE === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(hostname) &&
    new URL(env.PUBLIC_APP_ORIGIN).origin === new URL(request.url).origin
  );
}
