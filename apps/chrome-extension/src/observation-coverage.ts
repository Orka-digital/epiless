import {
  validPhaseClock,
  type PhaseClock,
  type PhaseReplayPlan,
} from './animation-phase';
import { type Observation } from './model';

import type { MediaReplayRequest } from './observation-evidence';
import type { ObservationServices } from './observation-services';
/** Extend to previously reached endpoints for at most 500ms per evidence channel; never widen tolerances. */
export async function completeReplayCoverage(
  services: ObservationServices,
  id: string,
  generation: string,
  initialUrl: string,
  observation: Observation,
  mediaReplay: MediaReplayRequest | undefined,
  phaseReplay: PhaseReplayPlan | undefined,
  phaseTriggerClock: PhaseClock | undefined,
) {
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
}
