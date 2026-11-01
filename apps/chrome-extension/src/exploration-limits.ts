import { actionPending, focusedAction, hoveredAction } from './scenario-plan';

import type {
  ExplorationContext,
  ExplorationServices,
} from './exploration-context';

/** Record unvisited scroll, control, focus and media states after the route budget. */
export async function recordExplorationLimits(
  services: ExplorationServices,
  context: ExplorationContext,
) {
  if (context.hasDiscoveredVideo() && context.loopAttempts.size === 0)
    await services.recordUnobserved(
      context.id,
      context.task.id,
      'media-loop-boundary-targeted',
      context.loopReason,
    );
  else if (context.loopReason === 'MEDIA_LOOP_SAMPLE_LIMIT_REACHED')
    await services.recordUnobserved(
      context.id,
      context.task.id,
      'remaining-media-loop-boundaries',
      context.loopReason,
    );
  if (context.page.scrollHeight > context.coveredBottom + 4) {
    await context.addLimit('SCROLL_LIMIT_REACHED');
    await services.recordUnobserved(
      context.id,
      context.task.id,
      'remaining-scroll',
      'SCROLL_OR_ACTION_BUDGET_REACHED',
    );
  }
  for (const pending of context.page.actions.filter((candidate) =>
    actionPending(candidate, context.exploration),
  )) {
    await context.addLimit('ACTION_LIMIT_REACHED');
    await services.recordUnobserved(
      context.id,
      context.task.id,
      `${pending.kind}-remaining`,
      'ACTION_BUDGET_REACHED',
    );
  }
  if (
    focusedAction(context.page.actions, {
      ...context.exploration,
      focusCount: 0,
    })
  )
    await services.recordUnobserved(
      context.id,
      context.task.id,
      'remaining-focus-states',
      'FOCUS_SAMPLE_OR_ACTION_LIMIT_REACHED',
    );
  if (
    context.page.actions.some(
      (candidate) =>
        candidate.kind === 'carousel' &&
        (context.exploration.attempts.get(candidate.id) ?? 0) >= 4,
    )
  )
    await services.recordUnobserved(
      context.id,
      context.task.id,
      'remaining-carousel-states',
      'CAROUSEL_TRANSITION_LIMIT_REACHED',
    );
  if (!context.job.advancedPointer)
    await services.recordUnobserved(
      context.id,
      context.task.id,
      'hover-states',
      'TRUSTED_POINTER_DRIVER_NOT_ENABLED',
    );
  else if (
    hoveredAction(context.page.actions, {
      ...context.exploration,
      hoverCount: 0,
    })
  )
    await services.recordUnobserved(
      context.id,
      context.task.id,
      'remaining-hover-states',
      'HOVER_SAMPLE_LIMIT_REACHED',
    );
}
