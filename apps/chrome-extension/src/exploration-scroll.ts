import { replayScenario } from './scenario-plan';

import type {
  ExplorationContext,
  ExplorationServices,
} from './exploration-context';

/** Measure bounded scrolling and preserve failed coverage without retrying indefinitely. */
export async function exploreScroll(
  services: ExplorationServices,
  context: ExplorationContext,
  nextScroll: number,
) {
  context.scrollSteps++;
  const y = Math.round(nextScroll);
  const achieved = await services.observe(
    context.id,
    context.generation,
    context.task.id,
    `scroll-${context.scrollSteps}`,
    3_000,
    async () => {
      const result = await services.content<{
        achieved: boolean;
        reason?: string;
      }>(context.id, context.generation, 'FG_SCROLL', { y });
      if (result.achieved) context.recipeSteps.push({ kind: 'scroll', y });
      else context.replayReliable = false;
      return result;
    },
    undefined,
    () =>
      context.replayReliable
        ? replayScenario(
            context.task.url,
            context.initialViewport,
            context.recipeSteps,
            3_000,
            'current',
            context.recipeSteps.length - 1,
          )
        : undefined,
  );
  if (!achieved) {
    await context.addLimit('SCROLL_STATE_UNOBSERVED');
    context.scrollSteps = 6;
  }
  context.recipeSteps.push({ kind: 'wait', durationMs: 3_000 });
  context.coveredBottom = Math.max(
    context.coveredBottom,
    y + context.page.viewport.height,
  );
}
