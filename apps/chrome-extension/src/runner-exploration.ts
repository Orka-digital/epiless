import { planLoopBoundary, type MediaSnapshot } from './media-loop';

import { nextScrollPosition } from './runner-policy';

import {
  actionPending,
  DELAYED_OBSERVATION_MS,
  focusedAction,
  hoveredAction,
  newExplorationState,
  replayScenario,
} from './scenario-plan';

import { exploreCompact } from './exploration-compact';
import type {
  ExplorationContext,
  ExplorationServices,
} from './exploration-context';
import { exploreControl } from './exploration-control';
import { recordExplorationLimits } from './exploration-limits';
import { exploreMediaLoop } from './exploration-media-loop';
import { exploreScroll } from './exploration-scroll';
import { mutateJob } from './store';

import type { ExplorationInput } from './exploration-context';
/** Explore bounded route actions with explicit shared progress and replay ownership. */
export async function exploreRoute(
  services: ExplorationServices,
  input: ExplorationInput,
) {
  const context: ExplorationContext = {
    ...input,
    replayReliable: true,
    actionCount: 0,
    scrollSteps: 0,
    loopAttempts: new Set(),
    loopReason: 'MEDIA_LOOP_ACTION_BUDGET_REACHED',
    coveredBottom: input.page.scrollY + input.page.viewport.height,
    exploration: newExplorationState(),
    reserveCompact: 0,
    addLimit: async () => undefined,
  };
  context.page = await context.inventory();
  // The compact profile shares the existing route budget: one viewport
  // observation and one safe responsive control, rather than more work.
  context.reserveCompact =
    context.page.viewport.width > 700
      ? Math.min(2, context.job.limits.maxActionsPerRoute)
      : 0;
  context.addLimit = async (reason: string) =>
    mutateJob(context.id, (state) => {
      if (!state.limitations.includes(reason)) state.limitations.push(reason);
    });
  while (
    context.actionCount <
    context.job.limits.maxActionsPerRoute - context.reserveCompact
  ) {
    const nextScroll = nextScrollPosition(
      context.page,
      context.coveredBottom,
      context.scrollSteps,
    );
    const consent = context.page.actions.find(
      (candidate) =>
        candidate.kind === 'consent-reject' &&
        actionPending(candidate, context.exploration),
    );
    const action = context.page.actions.find((candidate) =>
      actionPending(candidate, context.exploration),
    );
    const focus = focusedAction(context.page.actions, context.exploration);
    const hover = context.job.advancedPointer
      ? hoveredAction(context.page.actions, context.exploration)
      : undefined;
    // Confirm focus independently of activation, so focus-triggered content
    // has its own measured state instead of being hidden by the next click.
    const next = consent ?? hover ?? focus ?? action;
    const loop =
      !next && context.hasDiscoveredVideo()
        ? planLoopBoundary(
            await services
              .content<MediaSnapshot>(
                context.id,
                context.generation,
                'FG_MEDIA_SNAPSHOT',
              )
              .catch(() => ({
                complete: false,
                reasons: ['MEDIA_SNAPSHOT_UNAVAILABLE'],
                items: [],
              })),
            context.loopAttempts,
            new Set(
              context.page.actions
                .filter(
                  (candidate) => candidate.kind === 'media' && candidate.target,
                )
                .map((candidate) =>
                  JSON.stringify(candidate.target!.selectorPath),
                ),
            ),
          )
        : undefined;
    if (loop && 'reason' in loop) context.loopReason = loop.reason;
    if (next) {
      await exploreControl(services, context, next, consent, hover, focus);
    } else if (loop && 'plan' in loop) {
      await exploreMediaLoop(services, context, loop);
    } else if (nextScroll !== undefined) {
      await exploreScroll(services, context, nextScroll);
    } else break;
    context.actionCount++;
    context.page = await context.inventory();
  }
  await recordExplorationLimits(services, context);
  // Keep recording through the late window itself. A timer outside a
  // capture segment would miss precisely the delayed effect we seek.
  await services.observe(
    context.id,
    context.generation,
    context.task.id,
    'delayed-state',
    DELAYED_OBSERVATION_MS,
    undefined,
    undefined,
    () =>
      context.replayReliable
        ? replayScenario(
            context.task.url,
            context.initialViewport,
            context.recipeSteps,
            DELAYED_OBSERVATION_MS,
          )
        : undefined,
  );
  if (
    context.reserveCompact &&
    context.actionCount < context.job.limits.maxActionsPerRoute
  ) {
    await exploreCompact(services, context);
  } else if (context.reserveCompact) {
    await services.recordUnobserved(
      context.id,
      context.task.id,
      'compact-viewport',
      'ACTION_BUDGET_REACHED',
    );
  }
}
