import { renderSnapshotHtml } from '@epi-less/core';
import { revalidateAccount, exportAccount, deleteAccount } from './account';
import { createAuth, getSession, requireUser } from './auth';
import { assertConfigured, HttpError, type RuntimeEnv } from './types';
import {
  assertMutation,
  createChallenge,
  rateLimit,
  readJson,
  verifyChallenge,
} from './security';
import {
  cancelIntent,
  commitPublication,
  createIntent,
  getPublication,
  getModerationPublication,
  listModerationQueue,
  listOwnReportPage,
  listSites,
  moderatePublication,
  reportAbuse,
  updatePublication,
  verifyIntent,
} from './publications';

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

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
        // Parse a clone before expensive password work; Better Auth consumes the original.
        const authInput = await readJson(request.clone(), 16_384);
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
        if (
          typeof authInput.email === 'string' &&
          authInput.email.length > 254
        ) {
          throw new HttpError(
            400,
            'PROFILE_INVALID',
            'Dit e-mailadres is te lang.',
          );
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
      return createAuth(env).handler(request);
    }
    if (path === '/api/index' && read)
      return json(
        await listSites(env, {
          query: url.searchParams.get('q') || undefined,
          cursor: url.searchParams.get('cursor') || undefined,
          status: url.searchParams.get('status') || undefined,
          from: url.searchParams.get('from') || undefined,
          to: url.searchParams.get('to') || undefined,
          criterion: url.searchParams.get('criterion') || undefined,
        }),
      );
    if (
      ['/api/account/export', '/api/account/delete'].includes(path) &&
      request.method === 'POST'
    ) {
      const input = await readJson(request, 4096);
      const user = await revalidateAccount(request, env, input);
      if (path.endsWith('/export')) {
        const response = json(await exportAccount(env, user.id));
        response.headers.set(
          'Content-Disposition',
          'attachment; filename="epi-less-account.json"',
        );
        return response;
      }
      if (input.confirmation !== 'VERWIJDER')
        throw new HttpError(
          400,
          'CONFIRMATION_REQUIRED',
          'Typ VERWIJDER om je account en online rapporten definitief te verwijderen.',
        );
      return json(await deleteAccount(env, user.id));
    }
    if (path === '/api/moderation' && read) {
      const user = await requireUser(request, env);
      return json({ items: await listModerationQueue(env, user.id) });
    }
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
    if (path === '/api/publications/intents' && request.method === 'POST') {
      const user = await requireUser(request, env);
      await rateLimit(request, env, 'intent-account', user.id);
      const input = await readJson(request);
      assertExpectedAccount(input, user.id);
      return json(await createIntent(env, request, user.id, input), 201);
    }
    const cancelMatch = path.match(
      /^\/api\/publications\/intents\/([a-f0-9-]{36})$/iu,
    );
    if (cancelMatch && request.method === 'DELETE') {
      const user = await requireUser(request, env, { verified: false });
      const input = await readJson(request, 4096);
      assertExpectedAccount(input, user.id);
      return json(await cancelIntent(env, user.id, cancelMatch[1]!, input));
    }
    const verifyMatch = path.match(
      /^\/api\/publications\/intents\/([a-f0-9-]{36})\/verify$/iu,
    );
    if (verifyMatch && request.method === 'POST') {
      const user = await requireUser(request, env);
      const input = await readJson(request, 4096);
      assertExpectedAccount(input, user.id);
      return json(
        await verifyIntent(env, request, user.id, verifyMatch[1]!, input),
      );
    }
    if (path === '/api/publications' && request.method === 'POST') {
      const user = await requireUser(request, env);
      const input = await readJson(request, 4096);
      assertExpectedAccount(input, user.id);
      return json(await commitPublication(env, user.id, input.intentId), 201);
    }
    if (path === '/api/publications' && read) {
      const user = await requireUser(request, env, { verified: false });
      return json(
        await listOwnReportPage(
          env,
          user.id,
          url.searchParams.get('cursor') || undefined,
        ),
      );
    }
    const reportMatch = path.match(
      /^\/api\/publications\/([a-f0-9-]{36})(?:\/(abuse|moderate|export))?$/iu,
    );
    if (reportMatch) {
      const id = reportMatch[1]!;
      const operation = reportMatch[2];
      if (read && operation === 'moderate') {
        const user = await requireUser(request, env);
        const publication = await getModerationPublication(env, user.id, id);
        if (!publication)
          throw new HttpError(404, 'NOT_FOUND', 'Rapport niet gevonden.');
        return json(publication);
      }
      if (read && (!operation || operation === 'export')) {
        const session = await getSession(request, env);
        const publication = await getPublication(env, {
          id,
          token: url.searchParams.get('token') || undefined,
          userId: session?.user.id,
        });
        if (!publication)
          throw new HttpError(
            404,
            'NOT_FOUND',
            'Rapport niet gevonden of niet beschikbaar.',
          );
        if (operation === 'export') {
          const format = url.searchParams.get('format') || 'json';
          if (!['json', 'html'].includes(format))
            throw new HttpError(
              400,
              'INVALID_FORMAT',
              'Kies JSON of HTML als exportformaat.',
            );
          if (!publication.report)
            throw new HttpError(
              404,
              'NOT_FOUND',
              'De rapportinhoud is verwijderd.',
            );
          const response =
            format === 'html'
              ? new Response(renderSnapshotHtml(publication.report), {
                  headers: {
                    ...Object.fromEntries(json(null).headers),
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Security-Policy':
                      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
                  },
                })
              : json(publication.report);
          response.headers.set(
            'Content-Disposition',
            `attachment; filename="epi-less-${id}.${format}"`,
          );
          return response;
        }
        return json(publication);
      }
      const input = await readJson(request, 8192);
      const withdrawal =
        request.method === 'PATCH' &&
        !operation &&
        ['revoke', 'delete'].includes(String(input.action));
      const user = await requireUser(request, env, { verified: !withdrawal });
      if (request.method === 'PATCH' && !operation)
        return json(await updatePublication(env, user.id, id, input));
      if (request.method === 'POST' && operation === 'abuse')
        return json(await reportAbuse(env, request, user.id, id, input));
      if (request.method === 'POST' && operation === 'moderate')
        return json(await moderatePublication(env, user.id, id, input));
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

function assertExpectedAccount(input: Record<string, unknown>, userId: string) {
  if (
    input.expectedAccountId !== undefined &&
    input.expectedAccountId !== userId
  )
    throw new HttpError(
      409,
      'ACCOUNT_CHANGED',
      'Het aangemelde account is gewijzigd. Deze opdracht blijft gekoppeld aan het oorspronkelijke account.',
    );
}
