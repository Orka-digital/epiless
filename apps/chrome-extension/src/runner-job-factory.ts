import { ENGINE_VERSION } from '@epi-less/analysis-engine';
import { normalizePublicUrl } from '@epi-less/core';
import { SCANNER_BUILD_SHA256 } from './build-identity';
import type { BackgroundCommand } from './command-protocol';
import {
  DEFAULT_LIMITS,
  RUNNER_VERSION,
  viewportDuration,
  type ScanJob,
} from './model';
import type { CommandServices } from './runner-command-services';
import { hasHashRoute } from './runner-policy';

import type { DisposableScanOwner } from './disposable-scan';
import type { ReplayScenario } from './model';
/** Build the initial persisted job from validated start context; no browser or storage writes. */
export function initialScanJob(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'START' }>,
  context: {
    tab: { id: number; url: string };
    parsed: URL;
    decision: { url: string };
    replayTarget?: ReplayScenario;
    advancedOwner?: DisposableScanOwner;
    previous?: ScanJob;
    advancedPointer: boolean;
  },
): ScanJob {
  const {
    tab,
    parsed,
    decision,
    replayTarget,
    advancedOwner,
    previous,
    advancedPointer,
  } = context;
  const mode = replayTarget
    ? 'AUTONOMOUS'
    : message.mode === 'EXTENDED'
      ? 'EXTENDED'
      : message.mode === 'QUICK'
        ? 'QUICK'
        : 'AUTONOMOUS';
  const viewportMs = viewportDuration(mode, message.viewportSeconds);
  const job: ScanJob = {
    id: crypto.randomUUID(),
    engineVersion: ENGINE_VERSION,
    runnerVersion: RUNNER_VERSION,
    scannerBuildSha256: SCANNER_BUILD_SHA256,
    advancedPointer,
    ...(advancedOwner
      ? {
          disposableSource: {
            nonce: advancedOwner.nonce,
            originalTabId: advancedOwner.source.tabId,
            originalUrl: advancedOwner.source.url,
            closed: false,
            cleanupStatus: 'RETAINED' as const,
          },
        }
      : {}),
    tabId: tab.id,
    origin: parsed.origin,
    startUrl: normalizePublicUrl(decision.url),
    startedAt: services.now(),
    updatedAt: services.now(),
    state: 'AUTHORIZING',
    stopIntent: false,
    generation: crypto.randomUUID(),
    elapsedMs: 0,
    tasks: [
      {
        id: crypto.randomUUID(),
        url: decision.url,
        depth: 0,
        state: 'QUEUED',
        observations: [],
        reasons: [],
      },
    ],
    skippedLinks: 0,
    limitations: [
      'SUPPORTED_UI_PATTERNS_ONLY',
      'BACKGROUND_CAPTURE_REQUIRES_VALIDATION',
      ...(hasHashRoute(tab.url)
        ? [
            'HASH_VIEW_ROUTE_UNOBSERVED: only the current viewport is captured; fragment routing identity is omitted for privacy and not indexed as a tested route.',
          ]
        : []),
      ...(mode !== 'AUTONOMOUS'
        ? [
            'VIEWPORT_ONLY: only the current rendered viewport is measured; no automatic route discovery, navigation or scrolling.',
          ]
        : [
            'NAVIGATION_TRANSITIONS_INCLUDE_SOURCE_AND_DESTINATION: capture spans navigation; candidates during transitions do not identify a source element.',
          ]),
    ],
    mode,
    viewportDurationMs: viewportMs,
    ...(replayTarget
      ? {
          replayTarget,
          verificationOf: {
            jobId: previous!.id,
            taskId: message.replayOf!.taskId,
            observationId: message.replayOf!.observationId,
          },
        }
      : {}),
    limits: {
      ...DEFAULT_LIMITS,
      maxRoutes:
        replayTarget || mode !== 'AUTONOMOUS' ? 1 : DEFAULT_LIMITS.maxRoutes,
      maxDurationMs:
        mode !== 'AUTONOMOUS'
          ? viewportMs + 30_000
          : DEFAULT_LIMITS.maxDurationMs,
    },
  };
  if (replayTarget) {
    job.tasks[0].url = replayTarget.route;
    job.startUrl = replayTarget.route;
    job.limitations.push(
      'TARGETED_RECHECK_ONLY: one stored scenario is repeated; other states are not evaluated.',
    );
  }

  return job;
}
