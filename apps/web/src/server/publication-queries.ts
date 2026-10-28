import { type AuditReport } from '@epi-less/core';
import { ownerDetail, summarize } from './publication-presentation';
import {
  type OwnPublicationSummary,
  type PublicationDetail,
  type PublicationRow,
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
  const row = await env.DB.prepare(
    "SELECT * FROM publications WHERE id=? AND (owner_id=? OR (state='ACTIVE' AND ((visibility='PUBLIC' AND public_origin_allowed=1) OR (visibility='UNLISTED' AND token_hash=?))))",
  )
    .bind(args.id, args.userId || null, tokenHash)
    .first<PublicationRow>();
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

function pageCursor(rows: PublicationRow[], pageSize = 20) {
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
  // D1 limits LIKE/GLOB pattern complexity; ranges also handle long domains.
  let filter = domain
    ? ' AND ((origin>=? AND origin<?) OR (origin>=? AND origin<?))'
    : '';
  const bindings: (string | number)[] = [beforeTime, beforeTime, beforeId];
  if (domain)
    for (const prefix of [`https://${domain}`, `http://${domain}`])
      bindings.push(prefix, `${prefix}\uffff`);
  if (args.status) {
    filter += ' AND status=?';
    bindings.push(args.status);
  }
  if (from !== undefined) {
    filter += ' AND audited_at>=?';
    bindings.push(from);
  }
  if (to !== undefined) {
    filter += ' AND audited_at<?';
    bindings.push(to + 86400000);
  }
  // Both flash criteria share the current non-normative measurement pipeline.
  if (args.criterion) filter += ' AND scenario_count>0';
  const rows = await env.DB.prepare(
    `SELECT id,origin,status,route_count,visibility,state,revision,published_at,content_hash,author_name,audited_at,discovered_count,measured_count,scenario_count,candidate_count,engine_version,stop_reason,public_origin_allowed FROM publications WHERE visibility='PUBLIC' AND state='ACTIVE' AND public_origin_allowed=1 AND (published_at < ? OR (published_at=? AND id < ?))${filter} ORDER BY published_at DESC,id DESC LIMIT 21`,
  )
    .bind(...bindings)
    .all<PublicationRow>();
  const visible = rows.results.slice(0, 20);
  const last = visible.at(-1);
  return {
    items: visible.map(summarize),
    nextCursor:
      rows.results.length > 20 && last
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
  const rows = await env.DB.prepare(
    'SELECT id,origin,status,route_count,visibility,state,revision,published_at,content_hash,author_name,size_bytes,moderation_reason,share_version,audited_at,discovered_count,measured_count,scenario_count,candidate_count,engine_version,stop_reason,public_origin_allowed FROM publications WHERE owner_id=? AND (published_at < ? OR (published_at=? AND id < ?)) ORDER BY published_at DESC,id DESC LIMIT 21',
  )
    .bind(userId, beforeTime, beforeTime, beforeId)
    .all<PublicationRow>();
  const items: OwnPublicationSummary[] = await Promise.all(
    rows.results.slice(0, 20).map(async (row) => ({
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
  return { items, nextCursor: pageCursor(rows.results) };
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
  const rows = await env.DB.prepare(
    "SELECT id,origin,status,route_count,visibility,state,revision,published_at,content_hash,author_name,audited_at,discovered_count,measured_count,scenario_count,candidate_count,engine_version,stop_reason,public_origin_allowed FROM publications WHERE origin=? AND visibility='PUBLIC' AND state='ACTIVE' AND public_origin_allowed=1 AND (published_at < ? OR (published_at=? AND id < ?)) ORDER BY published_at DESC,id DESC LIMIT 21",
  )
    .bind(normalized, beforeTime, beforeTime, beforeId)
    .all<PublicationRow>();
  return {
    items: rows.results.slice(0, 20).map(summarize),
    nextCursor: pageCursor(rows.results),
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
  const totals = await env.DB.prepare(
    "SELECT count(*) AS reports,MIN(audited_at) AS first_audit,MAX(audited_at) AS last_audit,SUM(CASE WHEN candidate_count>0 THEN 1 ELSE 0 END) AS reports_with_candidates,SUM(candidate_count) AS candidates FROM publications WHERE origin=? AND visibility='PUBLIC' AND state='ACTIVE' AND public_origin_allowed=1",
  )
    .bind(origin)
    .first<{
      reports: number;
      first_audit: number | null;
      last_audit: number | null;
      reports_with_candidates: number | null;
      candidates: number | null;
    }>();
  const latest = await env.DB.prepare(
    "SELECT id,origin,status,route_count,visibility,state,revision,published_at,content_hash,author_name,audited_at,discovered_count,measured_count,scenario_count,candidate_count,engine_version,stop_reason,public_origin_allowed FROM publications WHERE origin=? AND visibility='PUBLIC' AND state='ACTIVE' AND public_origin_allowed=1 ORDER BY audited_at DESC,published_at DESC,id DESC LIMIT 1",
  )
    .bind(origin)
    .first<PublicationRow>();
  return {
    reports: page.items,
    nextCursor: page.nextCursor,
    totals,
    latest: latest ? summarize(latest) : null,
  };
}
