import { requireUser } from './auth';

import { type RuntimeEnv } from './types';

import { rateLimit, readJson } from './security';

import { assertExpectedAccount, json } from './api-response';
import {
  cancelIntent,
  commitPublication,
  createIntent,
  listOwnReportPage,
  verifyIntent,
} from './publications';

/** Handle the scoped endpoint after shared origin and rate checks; undefined leaves routing to the caller. */
export async function handleIntent(
  request: Request,
  env: RuntimeEnv,
  path: string,
  url: URL,
  read: boolean,
): Promise<Response | undefined> {
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
    return json(await cancelIntent(env, user.id, cancelMatch[1], input));
  }
  const verifyMatch = path.match(
    /^\/api\/publications\/intents\/([a-f0-9-]{36})\/verify$/iu,
  );
  if (verifyMatch && request.method === 'POST') {
    const user = await requireUser(request, env);
    const input = await readJson(request, 4096);
    assertExpectedAccount(input, user.id);
    return json(
      await verifyIntent(env, request, user.id, verifyMatch[1], input),
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
}
