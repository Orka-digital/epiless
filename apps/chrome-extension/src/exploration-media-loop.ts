import { LOOP_OBSERVATION_MS, planLoopBoundary } from './media-loop';

import { measuredMediaInterval } from './media-replay';

import { type ReplayStep } from './model';

import { replayScenario } from './scenario-plan';

import type {
  ExplorationContext,
  ExplorationServices,
} from './exploration-context';
import { mutateJob } from './store';

/** Prepare a bounded media loop and require observed playback and compositor wrap evidence. */
export async function exploreMediaLoop(
  services: ExplorationServices,
  context: ExplorationContext,
  loop: Extract<ReturnType<typeof planLoopBoundary>, { plan: unknown }>,
) {
  context.loopAttempts.add(loop.targetKey);
  const target = context.page.actions.find(
    (candidate) =>
      candidate.kind === 'media' &&
      JSON.stringify(candidate.target?.selectorPath) === loop.targetKey,
  )!.target!;
  const scenario = `media-loop-boundary-${context.loopAttempts.size}`;
  await services.recordUnobserved(
    context.id,
    context.task.id,
    `${scenario}-seek-transition`,
    'MEDIA_SEEK_PRECEDES_LOOP_MEASUREMENT',
  );
  const prepared = await services.content<{
    achieved: boolean;
    reason?: string;
  }>(context.id, context.generation, 'FG_MEDIA_REPLAY_PREPARE', {
    mediaPlan: loop.plan,
  });
  if (!prepared.achieved) {
    context.replayReliable = false;
    await services.recordUnobserved(
      context.id,
      context.task.id,
      scenario,
      prepared.reason ?? 'MEDIA_LOOP_PREPARATION_UNREACHED',
      'UNREACHED',
    );
  } else {
    const loopSteps: ReplayStep[] = [
      ...structuredClone(context.recipeSteps),
      { kind: 'control', target },
    ];
    await services.observe(
      context.id,
      context.generation,
      context.task.id,
      scenario,
      LOOP_OBSERVATION_MS,
      () =>
        services.content(context.id, context.generation, 'FG_ACTION', {
          target,
        }),
      undefined,
      () =>
        context.replayReliable
          ? replayScenario(
              context.task.url,
              context.initialViewport,
              loopSteps,
              LOOP_OBSERVATION_MS,
              'current',
              loopSteps.length - 1,
            )
          : undefined,
      { plan: loop.plan, prepared: true },
    );
    await mutateJob(context.id, (state) => {
      const observed = [
        ...state.tasks.find((value) => value.id === context.task.id)!
          .observations,
      ]
        .reverse()
        .find((value) => value.scenario === scenario);
      const media = observed?.mediaEvidence;
      const item = media?.items.find(
        (value) => JSON.stringify(value.before.selectorPath) === loop.targetKey,
      );
      const interval = item && measuredMediaInterval(item);
      if (
        observed &&
        (!media?.complete ||
          !interval ||
          interval.wraps < 1 ||
          interval.presentedWraps < 1)
      ) {
        observed.achieved = false;
        observed.coverage = 'UNREACHED';
        observed.reason = 'MEDIA_LOOP_BOUNDARY_NOT_CONFIRMED';
        if (observed.measurement) {
          observed.measurement.status = 'INCONCLUSIVE';
          observed.measurement.limitations.push(observed.reason);
        }
      }
    });
    // This seek changed media phase. Subsequent generic recipes
    // cannot recreate it solely with the prior control sequence.
    context.replayReliable = false;
  }
}
