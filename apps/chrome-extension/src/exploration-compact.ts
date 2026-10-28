import { type PageInventory, type ReplayStep } from './model';

import { nextTask } from './runner-policy';

import { replayScenario } from './scenario-plan';

import type {
  ExplorationContext,
  ExplorationServices,
} from './exploration-context';
import { getJob } from './store';

/** Measure the compact viewport with explicit restoration and uncertainty on failure. */
export async function exploreCompact(
  services: ExplorationServices,
  context: ExplorationContext,
) {
  let compactPhase = 'compact-viewport';
  let measurementAttempted = false;
  try {
    // Re-load the route before another viewport profile: this
    // resets interactions and makes its recipe independent and repeatable.
    await services.loadRoute(
      context.id,
      context.generation,
      context.task.url,
      context.task.id,
      context.task.navigationSource,
      context.task.navigationScrollY,
    );
    const method = 'PHYSICAL';
    await services.recordUnobserved(
      context.id,
      context.task.id,
      'compact-resize-transition',
      'VIEWPORT_NEGOTIATION_PRECEDES_MEASUREMENT',
    );
    const compact = await services.resizeViewport(
      context.id,
      context.generation,
      {
        width: 600,
        height: Math.min(720, context.initialViewport.height),
        dpr: context.initialViewport.dpr,
      },
      method,
    );
    const reset = await services.content<{ achieved: boolean }>(
      context.id,
      context.generation,
      'FG_SCROLL',
      { y: 0 },
    );
    if (!reset.achieved) throw new Error('COMPACT_INITIAL_SCROLL_UNREACHED');
    measurementAttempted = true;
    const compactObserved = await services.observe(
      context.id,
      context.generation,
      context.task.id,
      'compact-viewport',
      5_000,
      undefined,
      undefined,
      () =>
        replayScenario(
          context.task.url,
          compact.viewport,
          [],
          5_000,
          'compact',
          undefined,
          method,
        ),
    );
    context.actionCount++;
    if (!compactObserved)
      throw new Error('COMPACT_VIEWPORT_OBSERVATION_UNREACHED');
    compactPhase = 'compact-controls';
    measurementAttempted = false;
    const compactPage = await services.content<PageInventory>(
      context.id,
      context.generation,
      'FG_INVENTORY',
    );
    if (
      compactPage.mediaPresent ||
      compactPage.actions.some((action) => action.kind === 'media')
    ) {
      await services.recordUnobserved(
        context.id,
        context.task.id,
        'compact-media-loop-boundaries',
        'COMPACT_SINGLE_INTERACTION_SAMPLE_LIMIT',
      );
      await services.recordUnobserved(
        context.id,
        context.task.id,
        'compact-video-expanded-or-fullscreen',
        'EXPANDED_MEDIA_DISPLAY_NOT_IMPLEMENTED_IN_BACKGROUND_RUNNER',
      );
    }
    const responsive =
      compactPage.actions.find((action) => action.kind === 'consent-reject') ??
      compactPage.actions.find((action) => action.target);
    if (
      responsive &&
      context.actionCount < context.job.limits.maxActionsPerRoute
    ) {
      const duration = responsive.kind === 'media' ? 15_000 : 5_000;
      const compactSteps: ReplayStep[] = [{ kind: 'wait', durationMs: 5_000 }];
      measurementAttempted = true;
      await services.observe(
        context.id,
        context.generation,
        context.task.id,
        `compact-${responsive.kind}`,
        duration,
        async () => {
          const result = await services.content<{
            achieved: boolean;
            reason?: string;
            state?: string;
          }>(context.id, context.generation, 'FG_ACTION', {
            actionId: responsive.id,
          });
          if (result.achieved && responsive.target)
            compactSteps.push({
              kind: 'control',
              target: responsive.target,
              ...(result.state === undefined
                ? {}
                : { expectedState: result.state }),
            });
          return result;
        },
        undefined,
        () =>
          compactSteps.length === 2
            ? replayScenario(
                context.task.url,
                compact.viewport,
                compactSteps,
                duration,
                'compact',
                1,
                method,
              )
            : undefined,
      );
      context.actionCount++;
      await services.recordUnobserved(
        context.id,
        context.task.id,
        'compact-additional-states',
        'COMPACT_SINGLE_INTERACTION_SAMPLE_LIMIT',
      );
    } else if (responsive) {
      await services.recordUnobserved(
        context.id,
        context.task.id,
        'compact-controls',
        'ACTION_BUDGET_REACHED',
      );
    }
  } catch (error) {
    // observe() already persists the attempted segment in finally,
    // even if native geometry negotiation fails before BEGIN.
    if (!measurementAttempted)
      await services.recordUnobserved(
        context.id,
        context.task.id,
        compactPhase,
        services.errorText(error),
        'UNREACHED',
      );
    if (compactPhase === 'compact-viewport')
      await services.recordUnobserved(
        context.id,
        context.task.id,
        'compact-controls',
        'COMPACT_VIEWPORT_UNREACHED',
      );
    if (
      [
        'RUNNER_CANCELLED',
        'BUDGET_REACHED',
        'ORIGIN_CHANGED',
        'PERMISSION_REVOKED',
      ].includes(services.errorText(error))
    )
      throw error;
  } finally {
    try {
      if (
        services.workspace.emulatedViewports.has(context.id) ||
        services.workspace.restoreWindows.has(context.id) ||
        services.workspace.viewportWorkspaces.has(context.id)
      )
        await services.releaseCaptureSource(context.id, context.generation);
    } finally {
      await services.restoreEmulation(context.id);
      await services.restoreWindow(context.id);
      const afterCompact = await getJob(context.id);
      // Keep the final owned workspace active behind its cover until
      // terminal cleanup removes browser chrome. Between routes the
      // debugger and the previous attached-geometry contract remain.
      if (
        !services.workspace.pointerSessions.has(context.id) ||
        (afterCompact && nextTask(afterCompact))
      )
        await services.restoreWorkspace(context.id);
      await services.recordUnownedWorkspace(context.id);
    }
  }
}
