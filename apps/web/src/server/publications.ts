import { assertPublicOrigin, isPublicOrigin } from './public-origin';
import {
  contentHash,
  stableJson,
  validatePublicReport,
  type AuditReport,
} from '@epi-less/core';
import {
  HttpError,
  type RuntimeEnv,
  type Visibility,
  type PublicationState,
} from './types';
import {
  createChallenge,
  MAX_BODY,
  sha256,
  shareToken,
  verifyChallenge,
} from './security';

interface IntentRow {
  id: string;
  owner_id: string;
  idempotency_key: string;
  content_hash: string;
  visibility: Visibility;
  report_json: string | null;
  size_bytes: number;
  origin: string;
  status: string;
  route_count: number;
  state: 'PENDING' | 'VERIFIED' | 'CONSUMED' | 'EXPIRED';
  created_at: number;
  expires_at: number;
  verified_until: number | null;
  canceled_at: number | null;
}
interface PublicationRow {
  id: string;
  intent_id: string;
  owner_id: string;
  author_name: string;
  content_hash: string;
  visibility: Visibility;
  state: PublicationState;
  revision: number;
  report_json: string;
  origin: string;
  status: string;
  route_count: number;
  size_bytes: number;
  token_hash: string;
  share_version: number;
  published_at: number;
  revoked_at: number | null;
  moderation_reason: string | null;
  audited_at: number;
  discovered_count: number;
  measured_count: number;
  scenario_count: number;
  candidate_count: number;
  engine_version: string;
  stop_reason: string;
  public_origin_allowed: number;
}
export interface PublicationSummary {
  id: string;
  origin: string;
  status: string;
  routeCount: number;
  visibility: Visibility;
  state: PublicationState;
  revision: number;
  publishedAt: string;
  contentHash: string;
  authorName: string;
  publiclyListed: boolean;
  auditedAt: string;
  discoveredRoutes: number;
  measuredRoutes: number;
  scenarioCount: number;
  candidateCount: number;
  engineVersion: string;
  stopReason: string;
}
export interface PublicationDetail extends PublicationSummary {
  report: AuditReport | null;
  shareUrl?: string;
  moderationReason?: string | null;
}
export interface OwnPublicationSummary extends PublicationSummary {
  publicAccessNeedsConfirmation: boolean;
  hasReport: boolean;
  shareUrl?: string;
  moderationReason?: string | null;
}

function parseVisibility(value: unknown): Visibility {
  if (value !== 'PRIVATE' && value !== 'UNLISTED' && value !== 'PUBLIC')
    throw new HttpError(
      400,
      'INVALID_VISIBILITY',
      'Kies privé, verborgen link of openbaar.',
    );
  return value;
}
function summarize(row: PublicationRow): PublicationSummary {
  return {
    id: row.id,
    origin: row.origin,
    status: row.status,
    routeCount: row.route_count,
    visibility: row.visibility,
    state: row.state,
    revision: row.revision,
    publishedAt: new Date(row.published_at).toISOString(),
    contentHash: row.content_hash,
    authorName: row.author_name,
    publiclyListed:
      row.visibility === 'PUBLIC' &&
      row.state === 'ACTIVE' &&
      row.public_origin_allowed === 1,
    auditedAt: new Date(row.audited_at).toISOString(),
    discoveredRoutes: row.discovered_count,
    measuredRoutes: row.measured_count,
    scenarioCount: row.scenario_count,
    candidateCount: row.candidate_count,
    engineVersion: row.engine_version,
    stopReason: row.stop_reason,
  };
}
async function ownerDetail(
  env: RuntimeEnv,
  row: PublicationRow,
): Promise<PublicationDetail> {
  return {
    ...summarize(row),
    report: JSON.parse(row.report_json) as AuditReport | null,
    moderationReason: row.moderation_reason,
    shareUrl:
      row.state === 'ACTIVE' &&
      row.visibility !== 'PRIVATE' &&
      (row.visibility !== 'PUBLIC' || row.public_origin_allowed === 1)
        ? `${env.PUBLIC_APP_ORIGIN}/reports/${row.id}${row.visibility === 'UNLISTED' ? `?token=${await shareToken(env, `${row.id}:${row.share_version}`)}` : ''}`
        : undefined,
  };
}

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

export async function listOwnReports(
  env: RuntimeEnv,
  userId: string,
): Promise<OwnPublicationSummary[]> {
  return (await listOwnReportPage(env, userId)).items;
}
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

export async function createIntent(
  env: RuntimeEnv,
  request: Request,
  ownerId: string,
  input: Record<string, unknown>,
) {
  if (
    typeof input.idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(input.idempotencyKey)
  )
    throw new HttpError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Een geldige opdrachtsleutel is verplicht.',
    );
  const visibility = parseVisibility(input.visibility);
  let report: AuditReport;
  try {
    report = validatePublicReport(input.report);
  } catch {
    throw new HttpError(
      422,
      'INVALID_REPORT',
      'Het rapport is ongeldig of bevat niet-geredigeerde URL-parameters. Exporteer het opnieuw.',
    );
  }
  if (visibility === 'PUBLIC') assertPublicOrigin(report.origin);
  const json = stableJson(report);
  const size = new TextEncoder().encode(json).length;
  if (size > MAX_BODY)
    throw new HttpError(
      413,
      'REPORT_TOO_LARGE',
      'Het rapport mag maximaal 1 MiB groot zijn.',
    );
  const hash = await contentHash(report);
  if (input.contentHash !== undefined && input.contentHash !== hash)
    throw new HttpError(
      409,
      'SNAPSHOT_CHANGED',
      'Het rapport veranderde na de preview. Controleer het opnieuw.',
    );
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE publication_intents SET state='EXPIRED',report_json=NULL WHERE owner_id=? AND expires_at<? AND state IN ('PENDING','VERIFIED')",
  )
    .bind(ownerId, now)
    .run();
  const existing = await env.DB.prepare(
    'SELECT * FROM publication_intents WHERE owner_id=? AND idempotency_key=?',
  )
    .bind(ownerId, input.idempotencyKey)
    .first<IntentRow>();
  if (existing) {
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
    if (existing.state === 'CONSUMED')
      return {
        id: existing.id,
        contentHash: hash,
        state: existing.state,
        publication: await getPublication(env, {
          id: existing.id,
          userId: ownerId,
        }),
      };
    assertUploadsAvailable(env);
    if (existing.expires_at < now || existing.state === 'EXPIRED') {
      let renewed: D1Result;
      try {
        renewed = await env.DB.prepare(
          "UPDATE publication_intents SET state='PENDING',report_json=?,expires_at=?,verified_until=NULL WHERE id=? AND owner_id=? AND canceled_at IS NULL AND state!='CONSUMED' AND NOT EXISTS(SELECT 1 FROM publications WHERE id=?)",
        )
          .bind(json, now + 10 * 60_000, existing.id, ownerId, existing.id)
          .run();
      } catch (error) {
        if (String(error).includes('PENDING_QUOTA'))
          throw new HttpError(
            429,
            'PENDING_QUOTA',
            'Er staan al drie opdrachten open. Rond die af of annuleer een opdracht.',
          );
        throw error;
      }
      if (!renewed.meta.changes)
        throw new HttpError(
          409,
          'INTENT_CHANGED',
          'De opdracht is inmiddels gewijzigd.',
        );
      existing.state = 'PENDING';
    }
    return {
      id: existing.id,
      contentHash: hash,
      state: existing.state,
      challenge:
        existing.state === 'VERIFIED'
          ? null
          : await createChallenge(
              env,
              request,
              'publish',
              ownerId,
              existing.id,
            ),
    };
  }
  assertUploadsAvailable(env);
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      'INSERT INTO publication_intents(id,owner_id,idempotency_key,content_hash,visibility,report_json,size_bytes,origin,status,route_count,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        ownerId,
        input.idempotencyKey,
        hash,
        visibility,
        json,
        size,
        report.origin,
        report.status,
        report.routes.length,
        now,
        now + 10 * 60_000,
      )
      .run();
  } catch (error) {
    if (
      String(error).includes('PENDING_QUOTA') ||
      String(error).includes('UNIQUE')
    ) {
      const wonRace = await env.DB.prepare(
        'SELECT id FROM publication_intents WHERE owner_id=? AND idempotency_key=?',
      )
        .bind(ownerId, input.idempotencyKey)
        .first();
      if (wonRace) return createIntent(env, request, ownerId, input);
    }
    if (String(error).includes('PENDING_QUOTA'))
      throw new HttpError(
        429,
        'PENDING_QUOTA',
        'Er staan al drie opdrachten open. Rond die af of wacht tien minuten.',
      );
    throw error;
  }
  return {
    id,
    contentHash: hash,
    state: 'PENDING',
    challenge: await createChallenge(env, request, 'publish', ownerId, id),
  };
}

export async function verifyIntent(
  env: RuntimeEnv,
  request: Request,
  ownerId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const intent = await env.DB.prepare(
    'SELECT * FROM publication_intents WHERE id=? AND owner_id=?',
  )
    .bind(id, ownerId)
    .first<IntentRow>();
  if (!intent) throw new HttpError(404, 'NOT_FOUND', 'Opdracht niet gevonden.');
  if (intent.canceled_at !== null)
    throw new HttpError(
      409,
      'INTENT_CANCELLED',
      'Deze opdracht is geannuleerd.',
    );
  if (intent.state === 'CONSUMED')
    return {
      state: 'CONSUMED',
      publication: await getPublication(env, { id, userId: ownerId }),
    };
  if (intent.expires_at < Date.now())
    throw new HttpError(409, 'INTENT_EXPIRED', 'Deze opdracht is verlopen.');
  if (intent.state === 'VERIFIED' && (intent.verified_until || 0) >= Date.now())
    return { state: 'VERIFIED' };
  await verifyChallenge(env, request, {
    challengeId: input.challengeId,
    token: input.token,
    action: 'publish',
    ownerId,
    intentId: id,
  });
  const result = await env.DB.prepare(
    "UPDATE publication_intents SET state='VERIFIED',verified_until=? WHERE id=? AND owner_id=? AND state='PENDING' AND canceled_at IS NULL AND expires_at>=?",
  )
    .bind(
      Math.min(intent.expires_at, Date.now() + 10 * 60_000),
      id,
      ownerId,
      Date.now(),
    )
    .run();
  if (!result.meta.changes)
    throw new HttpError(
      409,
      'INTENT_CHANGED',
      'De opdracht is inmiddels gewijzigd.',
    );
  return { state: 'VERIFIED' };
}

export async function commitPublication(
  env: RuntimeEnv,
  ownerId: string,
  intentId: unknown,
): Promise<PublicationDetail> {
  if (typeof intentId !== 'string')
    throw new HttpError(
      400,
      'INTENT_REQUIRED',
      'De publicatieopdracht ontbreekt.',
    );
  const existing = await getPublication(env, { id: intentId, userId: ownerId });
  const owned = await env.DB.prepare(
    'SELECT id,origin,visibility FROM publication_intents WHERE id=? AND owner_id=?',
  )
    .bind(intentId, ownerId)
    .first<{ id: string; origin: string; visibility: Visibility }>();
  if (!owned) throw new HttpError(404, 'NOT_FOUND', 'Opdracht niet gevonden.');
  if (existing) return existing;
  assertUploadsAvailable(env);
  if (owned.visibility === 'PUBLIC') assertPublicOrigin(owned.origin);
  const now = Date.now();
  const tokenHash = await sha256(await shareToken(env, `${intentId}:1`));
  try {
    await env.DB.prepare(
      `INSERT INTO publications(id,intent_id,owner_id,author_name,content_hash,visibility,report_json,origin,status,route_count,size_bytes,token_hash,published_at,public_origin_allowed)
      SELECT id,id,owner_id,(SELECT name FROM user WHERE id=owner_id),content_hash,visibility,report_json,origin,status,route_count,size_bytes,?,?,? FROM publication_intents
      WHERE id=? AND owner_id=? AND state='VERIFIED' AND canceled_at IS NULL AND expires_at>=? AND verified_until>=? ON CONFLICT(intent_id) DO NOTHING`,
    )
      .bind(
        tokenHash,
        now,
        isPublicOrigin(owned.origin) ? 1 : 0,
        intentId,
        ownerId,
        now,
        now,
      )
      .run();
  } catch (error) {
    if (String(error).includes('QUOTA'))
      throw new HttpError(
        429,
        'ACCOUNT_QUOTA',
        'Je daglimiet (10 rapporten) of opslaglimiet (25 MiB) is bereikt.',
      );
    if (String(error).includes('GRANT_INVALID'))
      throw new HttpError(
        403,
        'GRANT_INVALID',
        'Verifieer deze opdracht opnieuw.',
      );
    throw error;
  }
  const result = await getPublication(env, { id: intentId, userId: ownerId });
  if (!result)
    throw new HttpError(
      403,
      'VERIFICATION_REQUIRED',
      'Verifieer de publicatie eerst.',
    );
  return result;
}

export async function updatePublication(
  env: RuntimeEnv,
  ownerId: string,
  id: string,
  input: Record<string, unknown>,
) {
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1)
    throw new HttpError(
      400,
      'REVISION_REQUIRED',
      'De actuele rapportrevisie ontbreekt.',
    );
  let statement: D1PreparedStatement;
  if (input.action === 'revoke') {
    statement = env.DB.prepare(
      "UPDATE publications SET state='REVOKED',revision=revision+1,revoked_at=? WHERE id=? AND owner_id=? AND revision=? AND state!='REVOKED'",
    ).bind(Date.now(), id, ownerId, input.revision);
  } else if (input.action === 'delete') {
    statement = env.DB.prepare(
      "UPDATE publications SET state='REVOKED',visibility='PRIVATE',report_json='null',size_bytes=0,origin='https://deleted.invalid',author_name='Verwijderd',route_count=0,status='ERROR',audited_at=0,discovered_count=0,measured_count=0,scenario_count=0,candidate_count=0,engine_version='',stop_reason='',revision=revision+1,revoked_at=? WHERE id=? AND owner_id=? AND revision=? AND size_bytes>0",
    ).bind(Date.now(), id, ownerId, input.revision);
  } else if (input.action === 'visibility' || input.action === 'rotate-link') {
    const visibility =
      input.action === 'rotate-link'
        ? 'UNLISTED'
        : parseVisibility(input.visibility);
    const scope = await env.DB.prepare(
      'SELECT origin FROM publications WHERE id=? AND owner_id=?',
    )
      .bind(id, ownerId)
      .first<{ origin: string }>();
    if (!scope) throw new HttpError(404, 'NOT_FOUND', 'Rapport niet gevonden.');
    if (visibility === 'PUBLIC') assertPublicOrigin(scope.origin);
    const version = (input.revision as number) + 1;
    const tokenHash = await sha256(await shareToken(env, `${id}:${version}`));
    statement = env.DB.prepare(
      "UPDATE publications SET visibility=?,revision=revision+1,share_version=?,token_hash=?,public_origin_allowed=? WHERE id=? AND owner_id=? AND revision=? AND state='ACTIVE' AND (? != 'rotate-link' OR visibility='UNLISTED')",
    ).bind(
      visibility,
      version,
      tokenHash,
      isPublicOrigin(scope.origin) ? 1 : 0,
      id,
      ownerId,
      input.revision,
      input.action,
    );
  } else {
    throw new HttpError(400, 'INVALID_ACTION', 'Onbekende rapportactie.');
  }
  const [result] = await env.DB.batch([
    statement,
    env.DB.prepare(
      "INSERT INTO erasure_log(id,entity_type,entity_id,action,revision,created_at) SELECT ?,'publication',id,?,revision,? FROM publications WHERE id=? AND owner_id=? AND revision=? AND changes()=1",
    ).bind(
      crypto.randomUUID(),
      input.action,
      Date.now(),
      id,
      ownerId,
      (input.revision as number) + 1,
    ),
  ]);
  if (!result?.meta.changes) {
    const owner = await env.DB.prepare(
      'SELECT id FROM publications WHERE id=? AND owner_id=?',
    )
      .bind(id, ownerId)
      .first();
    if (!owner) throw new HttpError(404, 'NOT_FOUND', 'Rapport niet gevonden.');
    throw new HttpError(
      409,
      'REVISION_CONFLICT',
      'Het rapport is gewijzigd. Vernieuw de pagina en probeer opnieuw.',
    );
  }
  return getPublication(env, { id, userId: ownerId });
}

export async function reportAbuse(
  env: RuntimeEnv,
  request: Request,
  ownerId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const accessible = await getPublication(env, {
    id,
    token: typeof input.token === 'string' ? input.token : undefined,
    userId: ownerId,
  });
  if (!accessible || accessible.state !== 'ACTIVE')
    throw new HttpError(404, 'NOT_FOUND', 'Rapport niet gevonden.');
  if (
    !['privacy', 'misleading', 'spam', 'other'].includes(
      String(input.category),
    ) ||
    typeof input.description !== 'string' ||
    input.description.trim().length < 10 ||
    input.description.length > 2000
  )
    throw new HttpError(
      400,
      'INVALID_ABUSE_REPORT',
      'Kies een reden en beschrijf die in 10 tot 2000 tekens.',
    );
  const existing = await env.DB.prepare(
    'SELECT id FROM abuse_reports WHERE publication_id=? AND reporter_id=?',
  )
    .bind(id, ownerId)
    .first();
  if (existing) return { accepted: true };
  await verifyChallenge(env, request, {
    action: 'abuse',
    ownerId,
    challengeId: input.challengeId,
    token: input.challengeToken,
  });
  await env.DB.prepare(
    'INSERT INTO abuse_reports(id,publication_id,reporter_id,category,description,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(publication_id,reporter_id) DO NOTHING',
  )
    .bind(
      crypto.randomUUID(),
      id,
      ownerId,
      input.category,
      input.description.trim(),
      Date.now(),
    )
    .run();
  return { accepted: true };
}

export async function moderatePublication(
  env: RuntimeEnv,
  moderatorId: string,
  id: string,
  input: Record<string, unknown>,
) {
  assertModerator(env, moderatorId);
  if (
    !['hide', 'dismiss'].includes(String(input.action)) ||
    typeof input.reason !== 'string' ||
    input.reason.trim().length < 10 ||
    input.reason.length > 2000 ||
    !Number.isSafeInteger(input.revision)
  )
    throw new HttpError(
      400,
      'INVALID_MODERATION',
      'Een actuele revisie en duidelijke reden zijn verplicht.',
    );
  if (input.action === 'dismiss') {
    const eventId = crypto.randomUUID();
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO moderation_events(id,publication_id,moderator_id,action,reason,created_at) SELECT ?,id,?,'dismiss',?,? FROM publications WHERE id=? AND revision=?",
      ).bind(
        eventId,
        moderatorId,
        input.reason.trim(),
        Date.now(),
        id,
        input.revision,
      ),
      env.DB.prepare(
        "UPDATE abuse_reports SET state='REVIEWED' WHERE publication_id=? AND EXISTS(SELECT 1 FROM moderation_events WHERE id=?)",
      ).bind(id, eventId),
    ]);
    if (!results[0]?.meta.changes)
      throw new HttpError(
        409,
        'REVISION_CONFLICT',
        'Het rapport is gewijzigd. Vernieuw de pagina.',
      );
    return { dismissed: true };
  }
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE publications SET state='HIDDEN_BY_MODERATION',moderation_reason=?,revision=revision+1 WHERE id=? AND revision=? AND state='ACTIVE'",
    ).bind(input.reason.trim(), id, input.revision),
    env.DB.prepare(
      "INSERT INTO erasure_log(id,entity_type,entity_id,action,revision,created_at) SELECT ?,'publication',id,'revoke',revision,? FROM publications WHERE id=? AND revision=? AND state='HIDDEN_BY_MODERATION' AND changes()=1",
    ).bind(crypto.randomUUID(), Date.now(), id, (input.revision as number) + 1),
    env.DB.prepare(
      "INSERT INTO moderation_events(id,publication_id,moderator_id,action,reason,created_at) SELECT ?,id,?,'hide',?,? FROM publications WHERE id=? AND state='HIDDEN_BY_MODERATION' AND revision=? AND changes()=1",
    ).bind(
      crypto.randomUUID(),
      moderatorId,
      input.reason.trim(),
      Date.now(),
      id,
      (input.revision as number) + 1,
    ),
    env.DB.prepare(
      "UPDATE abuse_reports SET state='REVIEWED' WHERE publication_id=? AND EXISTS(SELECT 1 FROM publications WHERE id=? AND state='HIDDEN_BY_MODERATION')",
    ).bind(id, id),
  ]);
  if (!results[0]?.meta.changes)
    throw new HttpError(
      409,
      'REVISION_CONFLICT',
      'Het rapport is gewijzigd of al ingetrokken.',
    );
  return { hidden: true };
}

function assertModerator(env: RuntimeEnv, userId: string): void {
  if (!isModerator(env, userId)) {
    throw new HttpError(403, 'FORBIDDEN', 'Geen moderatietoegang.');
  }
}

export function isModerator(env: RuntimeEnv, userId: string): boolean {
  return Boolean(
    env.MODERATOR_USER_IDS?.split(',')
      .map((id) => id.trim())
      .includes(userId),
  );
}

export interface ModerationItem {
  id: string;
  publicationId: string;
  category: string;
  description: string;
  createdAt: number;
  origin: string;
  visibility: Visibility;
  state: PublicationState;
  revision: number;
}

export async function listModerationQueue(env: RuntimeEnv, userId: string) {
  assertModerator(env, userId);
  const rows = await env.DB.prepare(
    `SELECT a.id,a.publication_id AS publicationId,a.category,a.description,a.created_at AS createdAt,
    p.origin,p.visibility,p.state,p.revision FROM abuse_reports a JOIN publications p ON p.id=a.publication_id
    WHERE a.state='OPEN' ORDER BY a.created_at ASC LIMIT 100`,
  ).all<ModerationItem>();
  return rows.results;
}

export async function getModerationPublication(
  env: RuntimeEnv,
  userId: string,
  id: string,
): Promise<PublicationDetail | null> {
  assertModerator(env, userId);
  if (!/^[a-f0-9-]{36}$/iu.test(id)) return null;
  const row = await env.DB.prepare('SELECT * FROM publications WHERE id=?')
    .bind(id)
    .first<PublicationRow>();
  if (!row) return null;
  return {
    ...summarize(row),
    report: JSON.parse(row.report_json) as AuditReport | null,
    moderationReason: row.moderation_reason,
  };
}

/** Cancellation and commit race on the same row; a committed report is never undone. */
export async function cancelIntent(
  env: RuntimeEnv,
  ownerId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const intent = await env.DB.prepare(
    'SELECT * FROM publication_intents WHERE id=? AND owner_id=?',
  )
    .bind(id, ownerId)
    .first<IntentRow>();
  if (!intent) throw new HttpError(404, 'NOT_FOUND', 'Opdracht niet gevonden.');
  if (input.contentHash !== intent.content_hash)
    throw new HttpError(
      409,
      'SNAPSHOT_CHANGED',
      'Deze annulering hoort bij een andere snapshot.',
    );
  await env.DB.prepare(
    "UPDATE publication_intents SET state='EXPIRED',report_json=NULL,origin='https://deleted.invalid',status='ERROR',route_count=0,canceled_at=?,verified_until=NULL WHERE id=? AND owner_id=? AND state!='CONSUMED' AND canceled_at IS NULL",
  )
    .bind(Date.now(), id, ownerId)
    .run();
  const current = await env.DB.prepare(
    'SELECT state,canceled_at FROM publication_intents WHERE id=? AND owner_id=?',
  )
    .bind(id, ownerId)
    .first<IntentRow>();
  if (current?.state === 'CONSUMED')
    return {
      state: 'CONSUMED',
      publication: await getPublication(env, { id, userId: ownerId }),
    };
  return { state: 'CANCELLED', canceled: true };
}

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

function assertUploadsAvailable(env: RuntimeEnv) {
  if (env.UPLOADS_PAUSED === 'true')
    throw new HttpError(
      503,
      'UPLOADS_PAUSED',
      'Online bewaren is tijdelijk gepauzeerd. Bestaande rapporten blijven beschikbaar; probeer later opnieuw.',
    );
}
