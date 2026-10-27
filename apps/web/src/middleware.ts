import { defineMiddleware } from 'astro:middleware';
import { getRuntime } from './server';
import { rateLimit } from './server/security';
import { HttpError } from './server/types';

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const protectedForm = /^\/(account|publish|verify|report-abuse)(\/|$)/u.test(
    path,
  );
  // Astro emits the exact hashes for its inline island bootstrap and bundled styles.
  // These route additions are applied before rendering; do not override those hashes
  // with a separate restrictive script-src header.
  if (protectedForm) {
    context.csp?.insertScriptResource('https://challenges.cloudflare.com');
    context.csp?.insertDirective('frame-src https://challenges.cloudflare.com');
    context.csp?.insertDirective(
      "connect-src 'self' https://challenges.cloudflare.com",
    );
  } else {
    context.csp?.insertDirective("frame-src 'none'");
    context.csp?.insertDirective("connect-src 'self'");
  }
  let response: Response;
  try {
    if (
      context.request.method === 'GET' &&
      /^\/(reports|sites|index|account)(\/|$)/u.test(path)
    ) {
      await rateLimit(
        context.request,
        getRuntime(context),
        'page-read',
        undefined,
        true,
      );
    }
    response = await next();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    response = new Response(error.message, {
      status: error.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
    if (error.status === 429) response.headers.set('Retry-After', '60');
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  response.headers.set('X-Frame-Options', 'DENY');
  if (context.url.protocol === 'https:')
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (
    /^\/(api|reports|sites|account|publish|verify|index|report-abuse)(\/|$)/u.test(
      path,
    )
  )
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  return response;
});
