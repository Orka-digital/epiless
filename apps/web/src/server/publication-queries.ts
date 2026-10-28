import {
  accessiblePublication,
  publicPage,
  ownerPage,
  publicOverview,
} from './db/publication-reads';
import { type AuditReport } from '@epi-less/core';
import { ownerDetail, summarize } from './publication-presentation';
import {
  type OwnPublicationSummary,
  type PublicationDetail,
} from './publication-types';
import { sha256, shareToken } from './security';
import { HttpError, type RuntimeEnv } from './types';

/**
 * Read a report only when ownership, public visibility or a valid link permits it.
 * @param env - Database and share URL bindings.
 * @param args - Identifier plus optional authenticated owner or unlisted token.
 * @returns Authorized detail, or null for an invalid, missing or inaccessible ID.
 */
export async function getPublication(
  env: RuntimeEnv,
  args: { id: string; token?: string; userId?: string },
): Promise<PublicationDetail | null> {
  if (!/^[a-f0-9-]{36}$/i.test(args.id)) return null;
  const tokenHash = args.token?.length === 64 ? await sha256(args.token) : null;
  const row = await accessiblePublication(env, args.id, args.userId, tokenHash);
  if (!row) return null;
  if (args.userId === row.owner_id) return ownerDetail(env, row);
  return {
    ...summarize(row),
    report: JSON.parse(row.report_json) as AuditReport,
  };
}

function publicationCursor(cursor?: string): [number, string] {
  if (!cursor) return [Number.MAX_SAFE_INTEGER, '\uffff'];
  try {
    if (cursor.length > 180) throw new Error();
    const parsed: unknown = JSON.parse(atob(cursor));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !Number.isSafeInteger(parsed[0]) ||
      parsed[0] < 0 ||
      typeof parsed[1] !== 'string' ||
      !/^[a-f0-9-]{36}$/iu.test(parsed[1])
    )
      throw new Error();
    return parsed as [number, string];
  } catch {
    throw new HttpError(400, 'INVALID_CURSOR', 'Ongeldige volgende pagina.');
  }
}

function pageCursor(
  rows: { id: string; published_at: number }[],
  pageSize = 20,
) {
  const last = rows.slice(0, pageSize).at(-1);
  return rows.length > pageSize && last
    ? btoa(JSON.stringify([last.published_at, last.id]))
    : null;
}

/**
 * Search the public index using metadata only and bounded cursor pagination.
 * @param env - Database binding.
 * @param args - Domain, status, date and criterion filters from the request.
 * @returns At most 20 summaries and a cursor for the next page.
 * @throws HttpError for invalid filters or cursors.
 */
export async function listSites(
  env: RuntimeEnv,
  args: {
    query?: string;
    cursor?: string;
    status?: string;
    from?: string;
    to?: string;
    criterion?: string;
  } = {},
) {
  const query = (args.query || '').trim().toLowerCase();
  if (query.length > 120 || /[%_\\\s]/u.test(query))
    throw new HttpError(
      400,
      'INVALID_QUERY',
      'Zoek op een domeinnaam (maximaal 120 tekens).',
    );
  const [beforeTime, beforeId] = publicationCursor(args.cursor);
  const statuses = [
    'NO_ISSUES_OBSERVED',
    'NEEDS_REVIEW',
    'INCONCLUSIVE',
    'ERROR',
  ];
  if (args.status && !statuses.includes(args.status))
    throw new HttpError(
      400,
      'INVALID_FILTER',
      'Kies een geldige meetuitkomst.',
    );
  if (args.criterion && !['2.3.1', '2.3.2'].includes(args.criterion))
    throw new HttpError(
      400,
      'INVALID_FILTER',
      'Kies criterium 2.3.1 of 2.3.2.',
    );
  const day = (value?: string) => {
    if (!value) return undefined;
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== value
    )
      throw new HttpError(
        400,
        'INVALID_FILTER',
        'Gebruik een geldige auditdatum.',
      );
    return parsed;
  };
  const from = day(args.from),
    to = day(args.to);
  if (from !== undefined && to !== undefined && from > to)
    throw new HttpError(
      400,
      'INVALID_FILTER',
      'De begindatum ligt na de einddatum.',
    );
  const domain = query.replace(/^https?:\/\//u, '').replace(/\/$/u, '');
  const rows = await publicPage(env, [beforeTime, beforeId], {
    domain,
    status: args.status,
    from,
    to,
    criterion: args.criterion,
  });
  const visible = rows.slice(0, 20);
  const last = visible.at(-1);
  return {
    items: visible.map(summarize),
    nextCursor:
      rows.length > 20 && last
        ? btoa(JSON.stringify([last.published_at, last.id]))
        : null,
  };
}

/**
 * Return the first page of summaries belonging to an authenticated account.
 * @param env - Database and share URL bindings.
 * @param userId - Authenticated owner.
 * @returns Up to 20 summaries; use listOwnReportPage when pagination is needed.
 */
export async function listOwnReports(
  env: RuntimeEnv,
  userId: string,
): Promise<OwnPublicationSummary[]> {
  return (await listOwnReportPage(env, userId)).items;
}

/**
 * Read owned report metadata without loading report bodies.
 * @param env - Database and share URL bindings.
 * @param userId - Authenticated owner.
 * @param cursor - Optional opaque cursor returned by the previous page.
 * @returns Up to 20 owner summaries and the next cursor.
 */
export async function listOwnReportPage(
  env: RuntimeEnv,
  userId: string,
  cursor?: string,
) {
  const [beforeTime, beforeId] = publicationCursor(cursor);
  const rows = await ownerPage(env, userId, [beforeTime, beforeId]);
  const items: OwnPublicationSummary[] = await Promise.all(
    rows.slice(0, 20).map(async (row) => ({
      ...summarize(row),
      hasReport: row.size_bytes > 0,
      publicAccessNeedsConfirmation:
        row.visibility === 'PUBLIC' && row.public_origin_allowed !== 1,
      moderationReason: row.moderation_reason,
      shareUrl:
        row.state === 'ACTIVE' &&
        row.visibility !== 'PRIVATE' &&
        (row.visibility !== 'PUBLIC' || row.public_origin_allowed === 1)
          ? `${env.PUBLIC_APP_ORIGIN}/reports/${row.id}${row.visibility === 'UNLISTED' ? `?token=${await shareToken(env, `${row.id}:${row.share_version}`)}` : ''}`
          : undefined,
    })),
  );
  return { items, nextCursor: pageCursor(rows) };
}

/**
 * Read active public snapshots for one canonical HTTP(S) origin.
 * @param env - Database binding.
 * @param origin - Exact origin, without path, query or fragment.
 * @param cursor - Optional publication cursor.
 * @returns A bounded page; private, revoked and unconfirmed legacy reports are excluded.
 */
export async function getSiteReportPage(
  env: RuntimeEnv,
  origin: string,
  cursor?: string,
) {
  let normalized: string;
  try {
    const parsed = new URL(origin);
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      parsed.origin !== origin
    )
      throw new Error();
    normalized = parsed.origin;
  } catch {
    throw new HttpError(
      400,
      'INVALID_ORIGIN',
      'Gebruik een volledige HTTP(S)-origin zonder pad.',
    );
  }
  const [beforeTime, beforeId] = publicationCursor(cursor);
  const rows = await publicPage(env, [beforeTime, beforeId], {
    origin: normalized,
  });
  return {
    items: rows.slice(0, 20).map(summarize),
    nextCursor: pageCursor(rows),
  };
}

/**
 * Combine one public report page with aggregate metadata for its origin.
 * @param env - Database binding.
 * @param origin - Canonical origin validated by the page query.
 * @param cursor - Optional cursor for the report list, not for the aggregates.
 * @returns Separate observations, totals and latest audit metadata; never a site-wide verdict.
 */
export async function getSiteSummary(
  env: RuntimeEnv,
  origin: string,
  cursor?: string,
) {
  // Reuse canonical validation and keep individual observations separate.
  const page = await getSiteReportPage(env, origin, cursor);
  const { totals, latest } = await publicOverview(env, origin);
  return {
    reports: page.items,
    nextCursor: page.nextCursor,
    totals,
    latest: latest ? summarize(latest) : null,
  };
}
