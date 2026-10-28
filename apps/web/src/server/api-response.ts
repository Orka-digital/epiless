import { HttpError } from './types';

/** Return private noncacheable JSON with restrictive metadata headers. */
export function json(data: unknown, status = 200): Response {
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

/** Reject work bound to a different signed-in account. */
export function assertExpectedAccount(
  input: Record<string, unknown>,
  userId: string,
) {
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
