import { phasePlanFromEvidence } from './animation-phase';
import { mediaPlanFromEvidence } from './media-replay';
import { type Observation, type ReplayScenario } from './model';
import { sameViewport } from './scenario-plan';
import { type DiagnosticContext } from './source-diagnostics';
import { replayStateKey } from './verification';

import type { MediaReplayRequest } from './observation-evidence';
import type { ObservationServices } from './observation-services';
/** Attach a replay recipe only for a reached stable viewport; retain explicit unsupported evidence. */
export async function attachObservationRecipe(
  services: ObservationServices,
  id: string,
  generation: string,
  observation: Observation,
  recipe: (() => ReplayScenario | undefined) | undefined,
  mediaReplay: MediaReplayRequest | undefined,
) {
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
      attachReplayPlans(observation, prepared, mediaReplay);
      prepared.stateKey = replayStateKey(prepared);
      observation.replay = prepared;
    } else if (prepared && observation.measurement)
      observation.measurement.limitations.push('REPLAY_VIEWPORT_NOT_CONFIRMED');
  }
}

function attachReplayPlans(
  observation: Observation,
  prepared: ReplayScenario,
  mediaReplay: MediaReplayRequest | undefined,
) {
  const observedPlan = mediaPlanFromEvidence(observation.mediaEvidence);
  if (observedPlan.status === 'UNSUPPORTED' && observation.measurement)
    observation.measurement.limitations.push('MEDIA_REPLAY_NOT_REPRODUCIBLE');
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
  if (!prepared.phasePlan || prepared.phasePlan.status === 'UNSUPPORTED')
    observation.measurement?.limitations.push(
      'ANIMATION_PHASE_REPLAY_NOT_REPRODUCIBLE',
    );
}
