import { type AuditReport } from '@epi-less/core';
import {
  type PublicationDetail,
  type PublicationRow,
  type PublicationSummary,
} from './publication-types';
import { shareToken } from './security';
import { HttpError, type RuntimeEnv, type Visibility } from './types';

/**
 * Validate an untrusted visibility choice without applying a default.
 * @throws HttpError unless the value is PRIVATE, UNLISTED or PUBLIC.
 */
export function parseVisibility(value: unknown): Visibility {
  if (value !== 'PRIVATE' && value !== 'UNLISTED' && value !== 'PUBLIC')
    throw new HttpError(
      400,
      'INVALID_VISIBILITY',
      'Kies privé, verborgen link of openbaar.',
    );
  return value;
}

/**
 * Project stored metadata into the transport shape without exposing the report body.
 */
export function summarize(row: PublicationRow): PublicationSummary {
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

/**
 * Build owner-only detail, exposing a share URL only while access remains active.
 */
export async function ownerDetail(
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
