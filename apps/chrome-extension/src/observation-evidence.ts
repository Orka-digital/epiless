import {
  copyPhaseEvidence,
  PHASE_ALIGNMENT_LEAD_MS,
  PHASE_WAIT_LIMIT_MS,
  validPhaseClock,
  type PhaseClock,
  type PhaseReplayPlan,
} from './animation-phase';
import { copyMediaEvidence, type MediaReplayPlan } from './media-replay';
import { type Observation } from './model';

import { completeReplayCoverage } from './observation-coverage';
import type { ObservationServices } from './observation-services';
/** Prepared replay input; the stored plan remains immutable during observation. */
export interface MediaReplayRequest {
  plan?: MediaReplayPlan;
  prepared: boolean;
  preserveRecipe?: boolean;
}
/** Own phase/media sessions and best-effort finalization; missing evidence remains explicit. */
export function createObservationEvidence(
  services: ObservationServices,
  id: string,
  generation: string,
  initialUrl: string,
  observation: Observation,
  mediaReplay?: MediaReplayRequest,
  phaseReplay?: PhaseReplayPlan,
) {
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

  return {
    prepare: async () => {
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
    },
    begin: async () => {
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
    },
    act: async (
      action?: () => Promise<{ achieved: boolean; reason?: string }>,
    ) => {
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
    },
    completeCoverage: () =>
      completeReplayCoverage(
        services,
        id,
        generation,
        initialUrl,
        observation,
        mediaReplay,
        phaseReplay,
        phaseTriggerClock,
      ),
    finishPhase,
    finishMedia,
    get mediaReplayFailed() {
      return mediaReplayFailed;
    },
  };
}
