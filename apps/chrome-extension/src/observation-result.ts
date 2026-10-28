import { collectSourceDiagnostics } from './collect-diagnostics';
import { type Observation, type ReplayScenario } from './model';
import {
  enqueueRoutes,
  hasHashRoute,
  observationRouteChanged,
} from './runner-policy';
import {
  guardCssReferenceContext,
  type CssReferenceContext,
  type DiagnosticContext,
} from './source-diagnostics';
import { getJob, mutateJob } from './store';

import type { MediaReplayRequest } from './observation-evidence';
import { attachObservationRecipe } from './observation-recipe';
import type { ObservationServices } from './observation-services';
/** Preserve pixel evidence even when diagnostics fail; mark route changes inconclusive before persistence. */
export async function persistObservationResult(
  services: ObservationServices,
  args: {
    id: string;
    generation: string;
    taskId: string;
    scenario: string;
    initialUrl: string;
    startUrl: string;
    tabId: number;
    observation: Observation;
    navigation?: { from: string; to: string };
    diagnosticContext?: DiagnosticContext;
    referenceContext?: CssReferenceContext;
    measurementEndedAt?: number;
    mediaReplayFailed: boolean;
    recipe?: () => ReplayScenario | undefined;
    mediaReplay?: MediaReplayRequest;
  },
) {
  const {
    id,
    generation,
    taskId,
    scenario,
    initialUrl,
    startUrl,
    observation,
    navigation,
    diagnosticContext,
    referenceContext,
    measurementEndedAt,
    mediaReplayFailed,
    recipe,
    mediaReplay,
  } = args;
  const latest = await getJob(id);
  const actualUrl = latest
    ? (await chrome.tabs.get(latest.tabId).catch(() => undefined))?.url
    : undefined;
  const actualNormalized = services.observedUrl(actualUrl, startUrl);
  const unexpectedRoute =
    !navigation && actualUrl && observationRouteChanged(initialUrl, actualUrl);
  if (navigation && actualUrl) navigation.to = actualNormalized;
  if (unexpectedRoute) {
    observation.navigation = { from: startUrl, to: actualNormalized };
    observation.achieved = false;
    observation.reason = hasHashRoute(actualUrl)
      ? 'HASH_ROUTER_TRANSITION_UNOBSERVED: fragment omitted; route identity is unsupported.'
      : 'ROUTE_CHANGED_DURING_OBSERVATION: transition frames include both routes; source attribution is unconfirmed.';
    if (observation.measurement) {
      observation.measurement.status = 'INCONCLUSIVE';
      observation.measurement.quality.interrupted = true;
      observation.measurement.limitations.push(observation.reason);
    }
  }
  await annotateObservationSources(
    services,
    id,
    generation,
    observation,
    diagnosticContext,
    measurementEndedAt,
  );
  if (mediaReplayFailed) {
    observation.achieved = false;
    observation.reason = 'MEDIA_REPLAY_PRECONDITION_UNREACHED';
    if (observation.measurement) {
      observation.measurement.status = 'INCONCLUSIVE';
      observation.measurement.limitations.push(observation.reason);
    }
  }
  observation.coverage =
    observation.achieved &&
    observation.measurement &&
    observation.measurement.quality.frameCount > 0
      ? 'TESTED'
      : 'UNREACHED';

  await attachObservationRecipe(
    services,
    id,
    generation,
    observation,
    recipe,
    mediaReplay,
  );
  if (observation.measurement) {
    // Re-read after the actual capture has ended. Revision counters also
    // invalidate transient changes whose final geometry/zoom looks identical.
    const [context, pageZoom] = await Promise.all([
      services
        .content<DiagnosticContext>(
          id,
          generation,
          'FG_DIAGNOSTIC_CONTEXT',
          {},
          1500,
        )
        .catch(() => undefined),
      chrome.tabs.getZoom(args.tabId).catch(() => undefined),
    ]);
    guardCssReferenceContext(
      observation.measurement,
      referenceContext,
      {
        context,
        pageZoom,
        zoomRevision: services.capture.pageZoomRevisions.get(args.tabId) ?? 0,
      },
      Boolean(observation.navigation) || !actualUrl,
    );
  }
  await mutateJob(id, (job) => {
    const task = job.tasks.find((candidate) => candidate.id === taskId)!;
    task.observations.push(observation);
    delete task.pendingAction;
    if (!observation.achieved)
      task.reasons.push(
        `${scenario}: ${observation.reason ?? 'State not reached'}`,
      );
    if (unexpectedRoute) {
      task.reasons.push(
        `Observed transition ${startUrl} → ${actualNormalized}; mixed-route frames cannot identify the source of a candidate.`,
      );
      if (job.mode === 'AUTONOMOUS') enqueueRoutes(job, [actualUrl], task);
    }
  });
}

async function annotateObservationSources(
  services: ObservationServices,
  id: string,
  generation: string,
  observation: Observation,
  diagnosticContext: DiagnosticContext | undefined,
  measurementEndedAt: number | undefined,
) {
  if (observation.measurement)
    await collectSourceDiagnostics(observation.measurement.findings, {
      expected: diagnosticContext,
      measurementEndedAt: measurementEndedAt ?? Date.now(),
      unavailableReason: observation.navigation
        ? 'NAVIGATION_TRANSITION_HAS_NO_STABLE_SOURCE'
        : !observation.achieved || observation.measurement.quality.interrupted
          ? 'INTERRUPTED_OBSERVATION_HAS_NO_STABLE_SOURCE'
          : undefined,
      guard: () => services.guard(id, generation),
      request: (request, timeoutMs) =>
        services.content(
          id,
          generation,
          'FG_DIAGNOSTIC_SOURCES',
          { request },
          timeoutMs,
        ),
    }).catch(() => {
      // Optional diagnostics must never discard the original pixel evidence.
      observation.measurement!.limitations.push(
        'SOURCE_DIAGNOSTICS_UNAVAILABLE',
      );
    });
}
