import type { FrameAnalyzer } from '@epi-less/analysis-engine';
import type { AuditReport } from '@epi-less/core';
import { SCANNER_BUILD_SHA256 } from './build-identity';

export type Measurement = ReturnType<FrameAnalyzer['finish']>;
export type JobState =
  | 'AUTHORIZING'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'INTERRUPTED'
  | 'ERROR';
type TaskState = 'QUEUED' | 'RUNNING' | 'OBSERVED' | 'PARTIAL' | 'SKIPPED';
type ControlKind =
  'accordion' | 'tab' | 'menu' | 'media' | 'carousel' | 'consent-reject';
export interface ReplayTarget {
  /** Direct-child structural paths, crossing only open shadow roots. No page text. */
  selectorPath: string[];
  kind: ControlKind;
}
export type ReplayStep =
  | { kind: 'scroll'; y: number }
  | {
      kind: 'control' | 'focus' | 'hover';
      target: ReplayTarget;
      expectedState?: string;
    }
  | { kind: 'wait'; durationMs: number };
export interface ReplayScenario {
  version: 1;
  route: string;
  viewport: { width: number; height: number; dpr: number };
  profile: 'current' | 'compact';
  /** Missing in early 0.4 records means the physical window path. */
  viewportMethod?: 'PHYSICAL' | 'CDP';
  steps: ReplayStep[];
  durationMs: number;
  /** Final trigger executed inside capture; earlier steps recreate prerequisites. */
  measuredStep?: number;
  stateKey: string;
  /** Local-only media locators and reproducible playback preconditions. */
  mediaPlan?: import('./media-replay').MediaReplayPlan;
  /** Local-only document and animation timing; no keyframe contents. */
  phasePlan?: import('./animation-phase').PhaseReplayPlan;
}
export interface Observation {
  id: string;
  scenario: string;
  startedAt: string;
  endedAt: string;
  achieved: boolean;
  reason?: string;
  measurement?: Measurement;
  navigation?: { from: string; to: string };
  coverage?: 'TESTED' | 'SKIPPED' | 'UNREACHED';
  replay?: ReplayScenario;
  /** Local-only observed media clocks; never copied into public reports. */
  mediaEvidence?: import('./media-replay').MediaEvidence;
  phaseEvidence?: import('./animation-phase').PhaseEvidence;
}
export type ScanMode = 'AUTONOMOUS' | 'QUICK' | 'EXTENDED';
export interface HistorySettings {
  schemaVersion: 1;
  /** null keeps event details until the user deletes them. Compact history is always retained. */
  detailRetentionDays: 30 | 90 | 365 | null;
}
export interface CandidateSummary {
  key: string;
  route: string;
  scenario: string;
  type: 'GENERAL_FLASH' | 'RED_FLASH' | 'ANIMATION_CONTROL';
  occurrences: number;
}
export interface RouteTask {
  id: string;
  url: string;
  depth: number;
  state: TaskState;
  observations: Observation[];
  reasons: string[];
  pendingAction?: string;
  /** Normalized page on which a rendered link was discovered; never a raw fragment/query. */
  navigationSource?: string;
  /** Bounded source scroll position that exposed a dynamically inserted link. */
  navigationScrollY?: number;
  /** Approved same-origin redirect aliases, retained for queue deduplication. */
  aliases?: string[];
  viewport?: { width: number; height: number; dpr: number };
}
export interface ScanJob {
  id: string;
  engineVersion?: string;
  runnerVersion?: string;
  scannerBuildSha256?: string;
  tabId: number;
  origin: string;
  startUrl: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  state: JobState;
  stopReason?: string;
  stopIntent: boolean;
  generation: string;
  interruptedTaskId?: string;
  elapsedMs: number;
  tasks: RouteTask[];
  skippedLinks: number;
  limitations: string[];
  mode: ScanMode;
  viewportDurationMs?: number;
  sitemapChecked?: boolean;
  detailsExpiredAt?: string;
  retainedCandidates?: CandidateSummary[];
  reviews?: import('./verification').IssueReview[];
  verificationOf?: { jobId: string; taskId: string; observationId: string };
  replayTarget?: ReplayScenario;
  advancedPointer?: boolean;
  disposableSource?: {
    nonce: string;
    originalTabId: number;
    originalUrl: string;
    closed?: boolean;
    cleanupStatus?: 'RETAINED' | 'CLOSED' | 'MANUAL';
  };
  limits: {
    maxRoutes: number;
    maxDepth: number;
    maxDurationMs: number;
    maxActionsPerRoute: number;
  };
}
export interface Transfer {
  nonce: string;
  jobId: string;
  expectedTabId: number;
  expiresAt: number;
  snapshot: AuditReport;
  contentHash: string;
}
export interface PageInventory {
  /** Bounded DOM discovery only; does not imply an allowed playback action. */
  mediaPresent?: boolean;
  url: string;
  title: string;
  links: string[];
  actions: {
    id: string;
    kind: ControlKind;
    label: string;
    target?: ReplayTarget;
    state?: string;
    focusable?: boolean;
  }[];
  viewport: { width: number; height: number; dpr: number };
  scrollHeight: number;
  scrollY: number;
  limitations: string[];
}
export const TERMINAL_STATES: JobState[] = [
  'COMPLETED',
  'PARTIAL',
  'INTERRUPTED',
  'ERROR',
];
export const DEFAULT_LIMITS = {
  maxRoutes: 50,
  maxDepth: 4,
  maxDurationMs: 20 * 60_000,
  maxActionsPerRoute: 12,
};
export const RUNNER_VERSION = '0.4.0';

/** A resumed audit must not silently mix detector or navigation semantics. */
export function canResumeWithVersions(
  job: ScanJob,
  engineVersion: string,
  currentBuild = SCANNER_BUILD_SHA256,
): boolean {
  return (
    job.engineVersion === engineVersion &&
    job.runnerVersion === RUNNER_VERSION &&
    typeof currentBuild === 'string' &&
    /^[a-f0-9]{64}$/.test(currentBuild) &&
    job.scannerBuildSha256 === currentBuild
  );
}
export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  schemaVersion: 1,
  detailRetentionDays: 90,
};
/** Return the configured bounded viewport observation duration. */
export function viewportDuration(mode: ScanMode, seconds?: unknown): number {
  if (mode !== 'EXTENDED') return 15_000;
  const value =
    typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : 30;
  return Math.round(Math.max(15, Math.min(120, value))) * 1000;
}
