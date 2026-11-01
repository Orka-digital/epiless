import { type PageInventory } from './model';

import { recordActionAttempt, replayScenario } from './scenario-plan';

import type {
  ExplorationContext,
  ExplorationServices,
} from './exploration-context';

/** Measure one admitted control and retain only reproducible achieved steps. */
export async function exploreControl(
  services: ExplorationServices,
  context: ExplorationContext,
  next: PageInventory['actions'][number],
  consent: PageInventory['actions'][number] | undefined,
  hover: PageInventory['actions'][number] | undefined,
  focus: PageInventory['actions'][number] | undefined,
) {
  const isHover = !consent && next === hover;
  const isFocus = !consent && !isHover && next === focus;
  if (isHover) {
    context.exploration.hovered.add(next.id);
    context.exploration.hoverCount++;
  } else if (isFocus) {
    context.exploration.focused.add(next.id);
    context.exploration.focusCount++;
  } else recordActionAttempt(next, context.exploration);
  const duration =
    isHover || isFocus ? 3_000 : next.kind === 'media' ? 15_000 : 5_000;
  const achieved = await services.observe(
    context.id,
    context.generation,
    context.task.id,
    `${isHover ? 'hover' : isFocus ? 'focus' : next.kind}-${context.actionCount + 1}`,
    duration,
    async () => {
      const result = isHover
        ? await services.hoverControl(
            context.id,
            context.generation,
            next.target!,
          )
        : await services.content<{
            achieved: boolean;
            reason?: string;
            state?: string;
          }>(
            context.id,
            context.generation,
            isFocus ? 'FG_FOCUS' : 'FG_ACTION',
            {
              actionId: next.id,
            },
          );
      if (result.achieved && next.target)
        context.recipeSteps.push({
          kind: isHover ? 'hover' : isFocus ? 'focus' : 'control',
          target: next.target,
          ...(result.state === undefined
            ? {}
            : { expectedState: result.state }),
        });
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
            duration,
            'current',
            context.recipeSteps.length - 1,
          )
        : undefined,
  );
  if (!achieved) {
    context.replayReliable = false;
    // A failed transition cannot justify repeating a carousel indefinitely.
    if (!isFocus && !isHover) context.exploration.attempts.set(next.id, 4);
  }
  context.recipeSteps.push({ kind: 'wait', durationMs: duration });
}
