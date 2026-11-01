import { type PhaseReplayPlan } from './animation-phase';
import { attachSourceTimelines } from './collect-diagnostics';
import {
  parseMeasurement,
  type ObservationCaptureState,
} from './measurement-protocol';
import { type MediaReplayPlan } from './media-replay';
import { type Observation, type ReplayScenario } from './model';
import { createObservationEvidence } from './observation-evidence';
import { persistObservationResult } from './observation-result';
import type { ObservationServices } from './observation-services';
import { prepareObservationSource } from './observation-source';
import { createRunnerReplay } from './runner-replay';
import {
  type CssReferenceContext,
  type DiagnosticContext,
} from './source-diagnostics';
import { mutateJob } from './store';

/** Coordinate one capture lifecycle; evidence owners finalize before results are persisted. */
export function createRunnerObservation(services: ObservationServices) {
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

    let diagnosticContext: DiagnosticContext | undefined;
    let referenceContext: CssReferenceContext | undefined;
    // Keep raw hash identity only in memory; persisted context always strips it.
    const initialUrl =
      (await chrome.tabs.get(initial.tabId)).url ?? initial.startUrl;
    const startUrl = services.observedUrl(initialUrl, initial.startUrl);
    const evidence = createObservationEvidence(
      services,
      id,
      generation,
      initialUrl,
      observation,
      mediaReplay,
      phaseReplay,
    );
    let segment: ObservationCaptureState = { state: 'unopened' };
    try {
      const prepared = await prepareObservationSource(
        services,
        id,
        generation,
        taskId,
        scenario,
        initial,
      );
      const { sourceId, sourceViewport, pageZoom, preparedContext } = prepared;
      diagnosticContext = prepared.diagnosticContext;
      referenceContext = prepared.referenceContext;
      await evidence.prepare();
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
      segment = { state: 'capturing', sourceId };
      await evidence.begin();
      await evidence.act(action);
      if (observation.achieved)
        await services.guardedWait(
          id,
          generation,
          duration,
          navigation?.to ?? initialUrl,
        );
      await evidence.completeCoverage();
      await evidence.finishPhase();
      await evidence.finishMedia();
      observation.measurement = parseMeasurement(
        await services.offscreen('SEGMENT_END', {
          generation,
          sourceId: segment.sourceId,
          interruption: observation.achieved ? undefined : observation.reason,
        }),
      );
      segment = {
        state: 'completed',
        endedAt: Date.now(),
        measurement: observation.measurement,
      };
    } catch (error) {
      observation.achieved = false;
      observation.reason = services.errorText(error);
      await evidence.finishPhase();
      if (!observation.mediaEvidence) await evidence.finishMedia();
      if (segment.state === 'capturing')
        observation.measurement = await services
          .offscreen('SEGMENT_END', {
            generation,
            sourceId: segment.sourceId,
            interruption: observation.reason,
          })
          .then(parseMeasurement)
          .catch(() => undefined);
      segment = {
        state: 'interrupted',
        endedAt: Date.now(),
        reason: observation.reason,
        measurement: observation.measurement,
      };
      throw error;
    } finally {
      const measurementEndedAt =
        'endedAt' in segment ? segment.endedAt : undefined;
      await evidence.finishPhase();
      if (!observation.mediaEvidence) await evidence.finishMedia();
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
      await persistObservationResult(services, {
        id,
        generation,
        taskId,
        scenario,
        initialUrl,
        startUrl,
        tabId: initial.tabId,
        observation,
        navigation,
        diagnosticContext,
        referenceContext,
        measurementEndedAt,
        mediaReplayFailed: evidence.mediaReplayFailed,
        recipe,
        mediaReplay,
      });
    }
    return observation.achieved;
  }
  return { observe, ...createRunnerReplay(services, observe) };
}
