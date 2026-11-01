import { deleteAccount, exportAccount, revalidateAccount } from './account';

import { HttpError, type RuntimeEnv } from './types';

import { readJson } from './security';

import { json } from './api-response';

/** Handle the scoped endpoint after shared origin and rate checks; undefined leaves routing to the caller. */
export async function handleAccount(
  request: Request,
  env: RuntimeEnv,
  path: string,
): Promise<Response | undefined> {
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
}
