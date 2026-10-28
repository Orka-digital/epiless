import { normalizePublicUrl } from '@epi-less/core';
import {
  copyPhaseEvidence,
  PHASE_ALIGNMENT_LEAD_MS,
  PHASE_WAIT_LIMIT_MS,
  phasePlanFromEvidence,
  validPhaseClock,
  type PhaseClock,
  type PhaseReplayPlan,
} from './animation-phase';
import {
  attachSourceTimelines,
  collectSourceDiagnostics,
} from './collect-diagnostics';
import {
  copyMediaEvidence,
  mediaPlanFromEvidence,
  type MediaReplayPlan,
} from './media-replay';
import {
  type Measurement,
  type Observation,
  type PageInventory,
  type ReplayScenario,
  type ReplayStep,
} from './model';
import type { RunnerOperations } from './runner-contracts';
import {
  enqueueRoutes,
  hasHashRoute,
  observationRouteChanged,
} from './runner-policy';
import type { CaptureOwner, WorkspaceOwner } from './runner-runtime';
import { sameViewport } from './scenario-plan';
import {
  guardCssReferenceContext,
  type CssReferenceContext,
  type DiagnosticContext,
} from './source-diagnostics';
import { getJob, mutateJob } from './store';
import { trustedHover } from './trusted-pointer';
import { replayStateKey } from './verification';

// Worker services are injected lazily; module construction never starts a scan.
export function createRunnerObservation(
  services: Pick<
    RunnerOperations,
    | 'guard'
    | 'now'
    | 'content'
    | 'observedUrl'
    | 'recordUnobserved'
    | 'prepareCaptureSource'
    | 'guardedWait'
    | 'offscreen'
    | 'errorText'
    | 'resizeViewport'
  > & { capture: CaptureOwner; workspace: WorkspaceOwner },
) {
  async function observe(
    id: string,
    generation: string,
    taskId: string,
    scenario: string,
    duration: number,
    action?: () => Promise<{ achieved: boolean; reason?: string }>,
    navigation?: { from: string; to: string },
    recipe?: () => ReplayScenario | undefined,
    mediaReplay?: {
      plan?: MediaReplayPlan;
      prepared: boolean;
      preserveRecipe?: boolean;
    },
    phaseReplay?: PhaseReplayPlan,
  ): Promise<boolean> {
    const initial = await services.guard(id, generation);
    await mutateJob(id, (job) => {
      const task = job.tasks.find((candidate) => candidate.id === taskId)!;
      task.pendingAction = scenario;
    });
    const observation: Observation = {
      id: crypto.randomUUID(),
      scenario,
      startedAt: services.now(),
      endedAt: services.now(),
      achieved: true,
      navigation,
    };
    let begun = false;
    let phaseStarted = false;
    let phaseFailure: string | undefined;
    let phaseTriggerClock: PhaseClock | undefined;
    const finishPhase = async () => {
      if (!phaseStarted) return;
      phaseStarted = false;
      const result = await services
        .content<unknown>(
          id,
          generation,
          'FG_PHASE_STOP',
          { generation, segmentId: observation.id },
          1500,
        )
        .catch(() => undefined);
      observation.phaseEvidence = copyPhaseEvidence(result);
      if (phaseFailure && observation.phaseEvidence) {
        observation.phaseEvidence.complete = false;
        observation.phaseEvidence.reasons = [
          ...new Set([...observation.phaseEvidence.reasons, phaseFailure]),
        ].slice(0, 32);
      }
    };
    let mediaStarted = false;
    let mediaReplayFailed = Boolean(mediaReplay?.plan && !mediaReplay.prepared);
    const finishMedia = async () => {
      const mediaResult =
        mediaStarted &&
        (await services
          .content<unknown>(
            id,
            generation,
            'FG_MEDIA_OBSERVATION_STOP',
            { generation, segmentId: observation.id },
            1500,
          )
          .catch(() => undefined));
      observation.mediaEvidence = copyMediaEvidence(mediaResult) ?? {
        version: 1,
        complete: false,
        reasons: ['MEDIA_OBSERVATION_UNAVAILABLE'],
        items: [],
      };
      if (mediaReplayFailed) {
        observation.mediaEvidence.complete = false;
        observation.mediaEvidence.reasons = [
          ...new Set([
            ...observation.mediaEvidence.reasons,
            'MEDIA_REPLAY_PRECONDITION_UNREACHED',
          ]),
        ].slice(0, 32);
      }
    };
    let nativeSourceId: string | undefined;
    let diagnosticContext: DiagnosticContext | undefined;
    let referenceContext: CssReferenceContext | undefined;
    let measurementEndedAt: number | undefined;
    // Keep raw hash identity only in memory; persisted context always strips it.
    const initialUrl =
      (await chrome.tabs.get(initial.tabId)).url ?? initial.startUrl;
    const startUrl = services.observedUrl(initialUrl, initial.startUrl);
    try {
      // Capture geometry BEFORE any measured action/frames. Comparing it after
      // observation fails closed for scrolling, navigation, zoom or resizing.
      diagnosticContext = await services
        .content<DiagnosticContext>(
          id,
          generation,
          'FG_DIAGNOSTIC_CONTEXT',
          {},
          1_500,
        )
        .catch(() => undefined);
      await services.guard(id, generation);
      if (!diagnosticContext) throw new Error('CAPTURE_VIEWPORT_UNAVAILABLE');
      const sourceViewport = {
        width: diagnosticContext.viewport.width,
        height: diagnosticContext.viewport.height,
        dpr:
          services.capture.capturePixelRatios.get(id) ??
          diagnosticContext.viewport.dpr,
      };
      if (
        Math.abs(sourceViewport.dpr - diagnosticContext.viewport.dpr) >= 0.001
      )
        throw new Error('CAPTURE_NATIVE_DPR_CHANGED');
      const previousSource = services.capture.captureSources.get(id);
      const changedSource =
        !previousSource?.active ||
        !sameViewport(previousSource.viewport, sourceViewport);
      if (changedSource)
        await services.recordUnobserved(
          id,
          taskId,
          `${scenario}-capture-source-transition`,
          'NATIVE_CAPTURE_SOURCE_REOPENED_OUTSIDE_MEASUREMENT',
        );
      const sourceId = await services.prepareCaptureSource(
        id,
        generation,
        sourceViewport,
      );
      nativeSourceId = sourceId;
      const zoomRevision =
        services.capture.pageZoomRevisions.get(initial.tabId) ?? 0;
      const preparedContext = await services.content<DiagnosticContext>(
        id,
        generation,
        'FG_DIAGNOSTIC_CONTEXT',
        {},
        1500,
      );
      if (
        !sameViewport(sourceViewport, preparedContext.viewport) ||
        preparedContext.documentToken !== diagnosticContext.documentToken
      )
        throw new Error('CAPTURE_VIEWPORT_CHANGED_DURING_SOURCE_START');
      diagnosticContext = preparedContext;
      const pageZoom = await chrome.tabs
        .getZoom(initial.tabId)
        .catch(() => undefined);
      referenceContext = {
        context: preparedContext,
        pageZoom,
        zoomRevision,
      };
      const mediaStart = await services
        .content<{ started: boolean }>(
          id,
          generation,
          'FG_MEDIA_OBSERVATION_START',
          { generation, segmentId: observation.id },
          1500,
        )
        .catch(() => undefined);
      mediaStarted = mediaStart?.started === true;
      await services
        .content(
          id,
          generation,
          'FG_SOURCE_TIMELINE_START',
          {
            generation,
            segmentId: observation.id,
          },
          1_500,
        )
        .catch(() => undefined);
      services.capture.openSegment({
        jobId: id,
        generation,
        segmentId: observation.id,
        events: [],
      });
      if (phaseReplay?.status === 'REPLAYABLE') {
        const at = await services
          .content<PhaseClock>(id, generation, 'FG_PHASE_CLOCK', {}, 1000)
          .catch(() => undefined);
        if (!validPhaseClock(at))
          phaseFailure = 'DOCUMENT_PHASE_CLOCK_UNAVAILABLE';
        else {
          const waitMs =
            phaseReplay.startDocumentMs -
            PHASE_ALIGNMENT_LEAD_MS -
            at.documentMs;
          if (waitMs > PHASE_WAIT_LIMIT_MS)
            phaseFailure = 'DOCUMENT_PHASE_WAIT_LIMIT_REACHED';
          else if (waitMs > 0)
            await services.guardedWait(id, generation, waitMs, initialUrl);
        }
      }
      await services.offscreen('SEGMENT_BEGIN', {
        generation,
        sourceId,
        segmentId: observation.id,
        sourceViewport,
        expectedViewport: sourceViewport,
        referenceMapping: {
          viewport: sourceViewport,
          pageZoom,
          visualScale: preparedContext.viewport.visualScale,
        },
      });
      begun = true;
      const phaseBegin = await services
        .content<{ begun: boolean }>(
          id,
          generation,
          'FG_PHASE_BEGIN',
          { generation, segmentId: observation.id },
          1500,
        )
        .catch(() => undefined);
      phaseStarted = phaseBegin?.begun === true;
      const mediaBegin =
        mediaStarted &&
        (await services
          .content<{ begun: boolean }>(
            id,
            generation,
            'FG_MEDIA_OBSERVATION_BEGIN',
            { generation, segmentId: observation.id },
            1500,
          )
          .catch(() => undefined));
      mediaStarted = Boolean(mediaStarted && mediaBegin && mediaBegin.begun);
      if (mediaReplay?.prepared) {
        const release = await services
          .content<{ achieved: boolean }>(
            id,
            generation,
            'FG_MEDIA_REPLAY_RELEASE',
            {},
            2000,
          )
          .catch(() => undefined);
        if (release?.achieved !== true) mediaReplayFailed = true;
      }
      if (action) {
        await services.guard(id, generation);
        const trigger = await services
          .content<{ marked: boolean; clock: PhaseClock }>(
            id,
            generation,
            'FG_PHASE_TRIGGER',
            { generation, segmentId: observation.id, stage: 'before' },
            1000,
          )
          .catch(() => undefined);
        phaseTriggerClock = trigger?.clock;
        const result = await action();
        await services
          .content(
            id,
            generation,
            'FG_PHASE_TRIGGER',
            { generation, segmentId: observation.id, stage: 'after' },
            1000,
          )
          .catch(() => undefined);
        observation.achieved = result.achieved;
        observation.reason = result.reason;
      }
      if (observation.achieved)
        await services.guardedWait(
          id,
          generation,
          duration,
          navigation?.to ?? initialUrl,
        );
      // Extend only to the original genuinely reached media endpoint, at most
      // 500ms. Failure remains explicit; no looser start/clip-position tolerance.
      if (
        observation.achieved &&
        mediaReplay?.prepared &&
        mediaReplay.plan?.coverage?.length
      ) {
        const deadline = performance.now() + 500;
        while (performance.now() < deadline) {
          const progress = await services
            .content<{ covered: boolean }>(
              id,
              generation,
              'FG_MEDIA_OBSERVATION_PROGRESS',
              {
                generation,
                segmentId: observation.id,
                mediaPlan: mediaReplay.plan,
              },
              250,
            )
            .catch(() => undefined);
          if (progress?.covered) break;
          await services.guardedWait(
            id,
            generation,
            Math.min(50, Math.max(0, deadline - performance.now())),
            initialUrl,
          );
        }
      }
      if (observation.achieved && phaseReplay?.status === 'REPLAYABLE') {
        const deadline = performance.now() + 500;
        const endpoint = Math.max(
          phaseReplay.endDocumentMs,
          phaseTriggerClock && phaseReplay.triggerDurationMs !== undefined
            ? phaseTriggerClock.documentMs + phaseReplay.triggerDurationMs
            : 0,
        );
        if (endpoint !== undefined)
          while (performance.now() < deadline) {
            const at = await services
              .content<PhaseClock>(id, generation, 'FG_PHASE_CLOCK', {}, 250)
              .catch(() => undefined);
            if (!validPhaseClock(at) || at.documentMs >= endpoint) break;
            await services.guardedWait(
              id,
              generation,
              Math.min(
                50,
                endpoint - at.documentMs,
                Math.max(0, deadline - performance.now()),
              ),
              initialUrl,
            );
          }
      }
      await finishPhase();
      await finishMedia();
      observation.measurement = (await services.offscreen('SEGMENT_END', {
        generation,
        sourceId: nativeSourceId,
        interruption: observation.achieved ? undefined : observation.reason,
      })) as Measurement;
      measurementEndedAt = Date.now();
      begun = false;
    } catch (error) {
      observation.achieved = false;
      observation.reason = services.errorText(error);
      await finishPhase();
      if (!observation.mediaEvidence) await finishMedia();
      if (begun)
        observation.measurement = (await services
          .offscreen('SEGMENT_END', {
            generation,
            sourceId: nativeSourceId,
            interruption: observation.reason,
          })
          .catch(() => undefined)) as Measurement | undefined;
      measurementEndedAt = Date.now();
      throw error;
    } finally {
      await finishPhase();
      if (!observation.mediaEvidence) await finishMedia();
      const pending =
        services.capture.activeSegment?.segmentId === observation.id
          ? services.capture.activeSegment
          : undefined;
      if (pending) {
        await Promise.allSettled(pending.events);
        services.capture.closeSegment(generation, observation.id);
      }
      const timeline = await services
        .content<Record<string, unknown>>(
          id,
          generation,
          'FG_SOURCE_TIMELINE_STOP',
          { generation, segmentId: observation.id },
          1_500,
        )
        .catch(() => undefined);
      if (timeline && observation.measurement)
        attachSourceTimelines(observation.measurement.findings, timeline);
      observation.endedAt = new Date(
        measurementEndedAt ?? Date.now(),
      ).toISOString();
      const latest = await getJob(id);
      const actualUrl = latest
        ? (await chrome.tabs.get(latest.tabId).catch(() => undefined))?.url
        : undefined;
      const actualNormalized = services.observedUrl(actualUrl, startUrl);
      const unexpectedRoute =
        !navigation &&
        actualUrl &&
        observationRouteChanged(initialUrl, actualUrl);
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
      if (observation.measurement)
        await collectSourceDiagnostics(observation.measurement.findings, {
          expected: diagnosticContext,
          measurementEndedAt: measurementEndedAt ?? Date.now(),
          unavailableReason: observation.navigation
            ? 'NAVIGATION_TRANSITION_HAS_NO_STABLE_SOURCE'
            : !observation.achieved ||
                observation.measurement.quality.interrupted
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
      if (observation.achieved && recipe && !observation.navigation) {
        const prepared = recipe();
        const reached =
          prepared &&
          (await services
            .content<DiagnosticContext>(
              id,
              generation,
              'FG_DIAGNOSTIC_CONTEXT',
              {},
              1500,
            )
            .catch(() => undefined));
        if (
          prepared &&
          reached &&
          sameViewport(prepared.viewport, reached.viewport)
        ) {
          const observedPlan = mediaPlanFromEvidence(observation.mediaEvidence);
          if (observedPlan.status === 'UNSUPPORTED' && observation.measurement)
            observation.measurement.limitations.push(
              'MEDIA_REPLAY_NOT_REPRODUCIBLE',
            );
          if (!mediaReplay?.preserveRecipe)
            prepared.mediaPlan = mediaReplay?.plan
              ? {
                  ...structuredClone(mediaReplay.plan),
                  ...(!mediaReplay.plan.coverage && observedPlan.coverage
                    ? { coverage: observedPlan.coverage }
                    : {}),
                }
              : observedPlan;
          if (!mediaReplay?.preserveRecipe)
            prepared.phasePlan = phasePlanFromEvidence(
              observation.phaseEvidence,
              observation.measurement?.findings ?? [],
              prepared.measuredStep !== undefined,
            );
          if (
            !prepared.phasePlan ||
            prepared.phasePlan.status === 'UNSUPPORTED'
          )
            observation.measurement?.limitations.push(
              'ANIMATION_PHASE_REPLAY_NOT_REPRODUCIBLE',
            );
          prepared.stateKey = replayStateKey(prepared);
          observation.replay = prepared;
        } else if (prepared && observation.measurement)
          observation.measurement.limitations.push(
            'REPLAY_VIEWPORT_NOT_CONFIRMED',
          );
      }
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
          chrome.tabs.getZoom(initial.tabId).catch(() => undefined),
        ]);
        guardCssReferenceContext(
          observation.measurement,
          referenceContext,
          {
            context,
            pageZoom,
            zoomRevision:
              services.capture.pageZoomRevisions.get(initial.tabId) ?? 0,
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
    return observation.achieved;
  }
  async function executeReplayStep(
    id: string,
    generation: string,
    step: ReplayStep,
  ) {
    const job = await services.guard(id, generation);
    if (step.kind === 'wait') {
      await services.guardedWait(
        id,
        generation,
        step.durationMs,
        job.replayTarget?.route,
      );
      return { achieved: true };
    }
    const result =
      step.kind === 'hover'
        ? await hoverControl(id, generation, step.target)
        : await services.content<{
            achieved: boolean;
            reason?: string;
            state?: string;
          }>(
            id,
            generation,
            step.kind === 'scroll'
              ? 'FG_SCROLL'
              : step.kind === 'focus'
                ? 'FG_FOCUS'
                : 'FG_ACTION',
            step.kind === 'scroll'
              ? { y: step.y }
              : { target: step.target, expectedState: step.expectedState },
          );
    if (
      result.achieved &&
      'expectedState' in step &&
      step.expectedState &&
      result.state !== step.expectedState
    )
      return { achieved: false, reason: 'REPLAY_CONTROL_STATE_MISMATCH' };
    return result;
  }
  async function hoverControl(
    id: string,
    generation: string,
    target: import('./model').ReplayTarget,
  ) {
    const job = await services.guard(id, generation);
    return trustedHover({
      enabled:
        job.advancedPointer === true &&
        chrome.runtime.getManifest().permissions?.includes('debugger') === true,
      tabId: job.tabId,
      target,
      guard: () => services.guard(id, generation),
      request: (type, target) =>
        services.content(id, generation, type, { target }),
      ownsDebuggerSession:
        services.workspace.pointerSessions.get(id)?.generation === generation,
    });
  }
  async function runReplay(
    id: string,
    generation: string,
    taskId: string,
    target: ReplayScenario,
  ) {
    let page = await services.content<PageInventory>(
      id,
      generation,
      'FG_INVENTORY',
    );
    if (
      target.viewportMethod === 'CDP' ||
      !sameViewport(target.viewport, page.viewport)
    ) {
      await services.recordUnobserved(
        id,
        taskId,
        'replay-viewport-transition',
        'VIEWPORT_NEGOTIATION_PRECEDES_MEASUREMENT',
      );
      page = await services.resizeViewport(
        id,
        generation,
        target.viewport,
        target.viewportMethod ?? 'PHYSICAL',
      );
    }
    if (normalizePublicUrl(page.url) !== target.route)
      throw new Error('REPLAY_ROUTE_NOT_REACHED');
    const prerequisites =
      target.measuredStep === undefined
        ? target.steps
        : target.steps.slice(0, target.measuredStep);
    for (const [index, step] of prerequisites.entries()) {
      const result = await executeReplayStep(id, generation, step);
      if (!result.achieved)
        throw new Error(
          `REPLAY_PREREQUISITE_${index + 1}_UNREACHED: ${result.reason}`,
        );
    }
    const actual = await services.content<PageInventory>(
      id,
      generation,
      'FG_INVENTORY',
    );
    if (!sameViewport(target.viewport, actual.viewport))
      throw new Error('REPLAY_VIEWPORT_CHANGED');
    const mediaPrepared =
      target.mediaPlan &&
      (await services
        .content<{ achieved: boolean }>(
          id,
          generation,
          'FG_MEDIA_REPLAY_PREPARE',
          { mediaPlan: target.mediaPlan },
          3500,
        )
        .catch(() => undefined));
    await observe(
      id,
      generation,
      taskId,
      'targeted-recheck',
      target.durationMs,
      target.measuredStep === undefined
        ? undefined
        : () =>
            executeReplayStep(
              id,
              generation,
              target.steps[target.measuredStep!],
            ),
      undefined,
      () => structuredClone(target),
      {
        plan: target.mediaPlan,
        prepared: mediaPrepared?.achieved === true,
        preserveRecipe: true,
      },
      target.phasePlan,
    );
  }
  return { observe, executeReplayStep, hoverControl, runReplay };
}
