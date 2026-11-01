import { validatePublicReport, type AuditReport } from '@epi-less/core';

import { parseVisibility } from './publication-presentation';

import { findIntent } from './db/intents';

import { HttpError } from './types';

/** Validate the untrusted public report and expose only a bounded public validation error. */
export function validatedIntentReport(input: unknown): AuditReport {
  let report: AuditReport;
  try {
    report = validatePublicReport(input);
  } catch {
    throw new HttpError(
      422,
      'INVALID_REPORT',
      'Het rapport is ongeldig of bevat niet-geredigeerde URL-parameters. Exporteer het opnieuw.',
    );
  }
  return report;
}

/** Reject idempotency reuse for different content, visibility or a cancelled snapshot. */
export function assertReusableIntent(
  existing: NonNullable<Awaited<ReturnType<typeof findIntent>>>,
  hash: string,
  visibility: ReturnType<typeof parseVisibility>,
): void {
  if (existing.content_hash !== hash || existing.visibility !== visibility)
    throw new HttpError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'Deze opdracht hoort bij een andere snapshot of zichtbaarheid.',
    );
  if (existing.canceled_at !== null)
    throw new HttpError(
      409,
      'INTENT_CANCELLED',
      'Deze opdracht is geannuleerd. Controleer een nieuwe preview om opnieuw te bewaren.',
    );
}
