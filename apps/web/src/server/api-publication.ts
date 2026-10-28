import { renderSnapshotHtml } from '@epi-less/core';

import { getSession, requireUser } from './auth';

import { HttpError, type RuntimeEnv } from './types';

import { readJson } from './security';

import { json } from './api-response';
import {
  getModerationPublication,
  getPublication,
  moderatePublication,
  reportAbuse,
  updatePublication,
} from './publications';

async function readPublication(
  request: Request,
  env: RuntimeEnv,
  id: string,
  url: URL,
  operation: string,
) {
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
      throw new HttpError(404, 'NOT_FOUND', 'De rapportinhoud is verwijderd.');
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

/** Dispatch publication mutations under the authenticated actor; unsupported operations fall through. */
export async function handlePublication(
  request: Request,
  env: RuntimeEnv,
  reportMatch: RegExpMatchArray,
  url: URL,
  read: boolean,
) {
  const id = reportMatch[1];
  const operation = reportMatch[2];
  if (read && operation === 'moderate') {
    const user = await requireUser(request, env);
    const publication = await getModerationPublication(env, user.id, id);
    if (!publication)
      throw new HttpError(404, 'NOT_FOUND', 'Rapport niet gevonden.');
    return json(publication);
  }
  if (read && (!operation || operation === 'export')) {
    return await readPublication(request, env, id, url, operation);
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
