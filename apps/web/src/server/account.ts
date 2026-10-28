import { createAuth, requireUser } from './auth';
import { eraseAccount } from './db/account-erasure';
import { accountExportRows } from './db/account-export';
import { rateLimit } from './security';
import { HttpError, type RuntimeEnv } from './types';

/** Require current credentials before account export or deletion. */
export async function revalidateAccount(
  request: Request,
  env: RuntimeEnv,
  input: Record<string, unknown>,
) {
  const user = await requireUser(request, env, { verified: false });
  if (input.expectedAccountId !== user.id)
    throw new HttpError(
      409,
      'ACCOUNT_CHANGED',
      'Het aangemelde account is gewijzigd. Vernieuw de pagina.',
    );
  if (
    typeof input.password !== 'string' ||
    input.password.length < 1 ||
    input.password.length > 128
  )
    throw new HttpError(
      400,
      'PASSWORD_REQUIRED',
      'Bevestig deze handeling met je huidige wachtwoord.',
    );
  await rateLimit(request, env, 'account-revalidation', user.id);
  try {
    await createAuth(env).api.verifyPassword({
      headers: request.headers,
      body: { password: input.password },
    });
  } catch {
    throw new HttpError(
      401,
      'REAUTHENTICATION_REQUIRED',
      'Je wachtwoord kon niet worden bevestigd. Meld je zo nodig opnieuw aan.',
    );
  }
  return user;
}

/** Explicit owner export; credentials, session tokens and Turnstile grants never leave the server. */
export async function exportAccount(env: RuntimeEnv, ownerId: string) {
  const rows = await accountExportRows(env, ownerId);
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    account: rows.account,
    publications: rows.publications.map(({ report_json, ...metadata }) => ({
      ...metadata,
      report: JSON.parse(String(report_json)) as unknown,
    })),
    pendingUploads: rows.intents.map(({ report_json, ...metadata }) => ({
      ...metadata,
      report: report_json ? (JSON.parse(String(report_json)) as unknown) : null,
    })),
    abuseReports: rows.abuseReports,
    moderationActions: rows.moderationActions,
    sessions: rows.sessions,
  };
}

/** D1 batch is transactional: no partial account erasure or surviving public link. */
export async function deleteAccount(env: RuntimeEnv, ownerId: string) {
  const changes = await eraseAccount(env, ownerId);
  if (!changes)
    throw new HttpError(
      404,
      'ACCOUNT_NOT_FOUND',
      'Dit account bestaat niet meer.',
    );
  return { deleted: true };
}
