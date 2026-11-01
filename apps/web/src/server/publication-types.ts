import { type AuditReport } from '@epi-less/core';
import { type PublicationState, type Visibility } from './types';

import type { publications } from './db/schema';

/** Storage shape inferred from the shared schema, never maintained separately. */
export type PublicationRow = typeof publications.$inferSelect;

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
