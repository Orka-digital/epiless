import { type AuditReport } from '@epi-less/core';
import { type PublicationState, type Visibility } from './types';

/** Stored owner-bound snapshot and its verification/consumption lifecycle. */
export interface IntentRow {
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

/** Publication storage fields; detail reads select the full row, list queries select metadata. */
export interface PublicationRow {
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

/** Metadata-only transport projection; contains neither report content nor share credentials. */
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

/** Authorized report detail; owner reads may include the current unlisted share URL. */
export interface PublicationDetail extends PublicationSummary {
  report: AuditReport | null;
  shareUrl?: string;
  moderationReason?: string | null;
}

/** Owner list entry with access-reconfirmation and retained-content indicators. */
export interface OwnPublicationSummary extends PublicationSummary {
  publicAccessNeedsConfirmation: boolean;
  hasReport: boolean;
  shareUrl?: string;
  moderationReason?: string | null;
}

/** Open abuse report joined to the publication revision a moderator must review. */
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
