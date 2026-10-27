import {
  LOOP_OBSERVATION_MS,
  planLoopBoundary,
  type MediaSnapshot,
} from './media-loop';
import { measuredMediaInterval } from './media-replay';
import type { RouteTask } from './model';
import { type PageInventory, type ReplayStep, type ScanJob } from './model';
import { nextScrollPosition, nextTask } from './runner-policy';
import type { SchedulerServices } from './runner-services';
import {
  actionPending,
  DELAYED_OBSERVATION_MS,
  focusedAction,
  hoveredAction,
  newExplorationState,
  recordActionAttempt,
  replayScenario,
} from './scenario-plan';
import { getJob, mutateJob } from './store';

/** Bounded autonomous route exploration, including the compact viewport sample. */
export async function exploreRoute(
  services: Pick<
    SchedulerServices,
    | 'content'
    | 'observe'
    | 'hoverControl'
    | 'recordUnobserved'
    | 'loadRoute'
    | 'resizeViewport'
    | 'errorText'
    | 'workspace'
    | 'releaseCaptureSource'
    | 'restoreEmulation'
    | 'restoreWindow'
    | 'restoreWorkspace'
    | 'recordUnownedWorkspace'
  >,
  {
    id,
    generation,
    job,
    task,
    page,
    initialViewport,
    recipeSteps,
    inventory,
    hasDiscoveredVideo,
  }: {
    id: string;
    generation: string;
    job: ScanJob;
    task: RouteTask;
    page: PageInventory;
    initialViewport: PageInventory['viewport'];
    recipeSteps: ReplayStep[];
    hasDiscoveredVideo: () => boolean;
    inventory: () => Promise<PageInventory>;
  },
) {
  let replayReliable = true;

  let actionCount = 0;
  let scrollSteps = 0;
  const loopAttempts = new Set<string>();
  let loopReason = 'MEDIA_LOOP_ACTION_BUDGET_REACHED';
  let coveredBottom = page.scrollY + page.viewport.height;
  const exploration = newExplorationState();
  page = await inventory();
  // The compact profile shares the existing route budget: one viewport
  // observation and one safe responsive control, rather than more work.
  const reserveCompact =
    page.viewport.width > 700 ? Math.min(2, job.limits.maxActionsPerRoute) : 0;
  const addLimit = async (reason: string) =>
    mutateJob(id, (state) => {
      if (!state.limitations.includes(reason)) state.limitations.push(reason);
    });
  while (actionCount < job.limits.maxActionsPerRoute - reserveCompact) {
    const nextScroll = nextScrollPosition(page, coveredBottom, scrollSteps);
    const consent = page.actions.find(
      (candidate) =>
        candidate.kind === 'consent-reject' &&
        actionPending(candidate, exploration),
    );
    const action = page.actions.find((candidate) =>
      actionPending(candidate, exploration),
    );
    const focus = focusedAction(page.actions, exploration);
    const hover = job.advancedPointer
      ? hoveredAction(page.actions, exploration)
      : undefined;
    // Confirm focus independently of activation, so focus-triggered content
    // has its own measured state instead of being hidden by the next click.
    const next = consent ?? hover ?? focus ?? action;
    const loop =
      !next && hasDiscoveredVideo()
        ? planLoopBoundary(
            await services
              .content<MediaSnapshot>(id, generation, 'FG_MEDIA_SNAPSHOT')
              .catch(() => ({
                complete: false,
                reasons: ['MEDIA_SNAPSHOT_UNAVAILABLE'],
                items: [],
              })),
            loopAttempts,
            new Set(
              page.actions
                .filter(
                  (candidate) => candidate.kind === 'media' && candidate.target,
                )
                .map((candidate) =>
                  JSON.stringify(candidate.target!.selectorPath),
                ),
            ),
          )
        : undefined;
    if (loop && 'reason' in loop) loopReason = loop.reason;
    if (next) {
      const isHover = !consent && next === hover;
      const isFocus = !consent && !isHover && next === focus;
      if (isHover) {
        exploration.hovered.add(next.id);
        exploration.hoverCount++;
      } else if (isFocus) {
        exploration.focused.add(next.id);
        exploration.focusCount++;
      } else recordActionAttempt(next, exploration);
      const duration =
        isHover || isFocus ? 3_000 : next.kind === 'media' ? 15_000 : 5_000;
      const achieved = await services.observe(
        id,
        generation,
        task.id,
        `${isHover ? 'hover' : isFocus ? 'focus' : next.kind}-${actionCount + 1}`,
        duration,
        async () => {
          const result = isHover
            ? await services.hoverControl(id, generation, next.target!)
            : await services.content<{
                achieved: boolean;
                reason?: string;
                state?: string;
              }>(id, generation, isFocus ? 'FG_FOCUS' : 'FG_ACTION', {
                actionId: next.id,
              });
          if (result.achieved && next.target)
            recipeSteps.push({
              kind: isHover ? 'hover' : isFocus ? 'focus' : 'control',
              target: next.target,
              ...(result.state === undefined
                ? {}
                : { expectedState: result.state }),
            });
          else replayReliable = false;
          return result;
        },
        undefined,
        () =>
          replayReliable
            ? replayScenario(
                task.url,
                initialViewport,
                recipeSteps,
                duration,
                'current',
                recipeSteps.length - 1,
              )
            : undefined,
      );
      if (!achieved) {
        replayReliable = false;
        // A failed transition cannot justify repeating a carousel indefinitely.
        if (!isFocus && !isHover) exploration.attempts.set(next.id, 4);
      }
      recipeSteps.push({ kind: 'wait', durationMs: duration });
    } else if (loop && 'plan' in loop) {
      loopAttempts.add(loop.targetKey);
      const target = page.actions.find(
        (candidate) =>
          candidate.kind === 'media' &&
          JSON.stringify(candidate.target?.selectorPath) === loop.targetKey,
      )!.target!;
      const scenario = `media-loop-boundary-${loopAttempts.size}`;
      await services.recordUnobserved(
        id,
        task.id,
        `${scenario}-seek-transition`,
        'MEDIA_SEEK_PRECEDES_LOOP_MEASUREMENT',
      );
      const prepared = await services.content<{
        achieved: boolean;
        reason?: string;
      }>(id, generation, 'FG_MEDIA_REPLAY_PREPARE', {
        mediaPlan: loop.plan,
      });
      if (!prepared.achieved) {
        replayReliable = false;
        await services.recordUnobserved(
          id,
          task.id,
          scenario,
          prepared.reason ?? 'MEDIA_LOOP_PREPARATION_UNREACHED',
          'UNREACHED',
        );
      } else {
        const loopSteps: ReplayStep[] = [
          ...structuredClone(recipeSteps),
          { kind: 'control', target },
        ];
        await services.observe(
          id,
          generation,
          task.id,
          scenario,
          LOOP_OBSERVATION_MS,
          () => services.content(id, generation, 'FG_ACTION', { target }),
          undefined,
          () =>
            replayReliable
              ? replayScenario(
                  task.url,
                  initialViewport,
                  loopSteps,
                  LOOP_OBSERVATION_MS,
                  'current',
                  loopSteps.length - 1,
                )
              : undefined,
          { plan: loop.plan, prepared: true },
        );
        await mutateJob(id, (state) => {
          const observed = [
            ...state.tasks.find((value) => value.id === task.id)!.observations,
          ]
            .reverse()
            .find((value) => value.scenario === scenario);
          const media = observed?.mediaEvidence;
          const item = media?.items.find(
            (value) =>
              JSON.stringify(value.before.selectorPath) === loop.targetKey,
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
        replayReliable = false;
      }
    } else if (nextScroll !== undefined) {
      scrollSteps++;
      const y = Math.round(nextScroll);
      const achieved = await services.observe(
        id,
        generation,
        task.id,
        `scroll-${scrollSteps}`,
        3_000,
        async () => {
          const result = await services.content<{
            achieved: boolean;
            reason?: string;
          }>(id, generation, 'FG_SCROLL', { y });
          if (result.achieved) recipeSteps.push({ kind: 'scroll', y });
          else replayReliable = false;
          return result;
        },
        undefined,
        () =>
          replayReliable
            ? replayScenario(
                task.url,
                initialViewport,
                recipeSteps,
                3_000,
                'current',
                recipeSteps.length - 1,
              )
            : undefined,
      );
      if (!achieved) {
        await addLimit('SCROLL_STATE_UNOBSERVED');
        scrollSteps = 6;
      }
      recipeSteps.push({ kind: 'wait', durationMs: 3_000 });
      coveredBottom = Math.max(coveredBottom, y + page.viewport.height);
    } else break;
    actionCount++;
    page = await inventory();
  }
  if (hasDiscoveredVideo() && loopAttempts.size === 0)
    await services.recordUnobserved(
      id,
      task.id,
      'media-loop-boundary-targeted',
      loopReason,
    );
  else if (loopReason === 'MEDIA_LOOP_SAMPLE_LIMIT_REACHED')
    await services.recordUnobserved(
      id,
      task.id,
      'remaining-media-loop-boundaries',
      loopReason,
    );
  if (page.scrollHeight > coveredBottom + 4) {
    await addLimit('SCROLL_LIMIT_REACHED');
    await services.recordUnobserved(
      id,
      task.id,
      'remaining-scroll',
      'SCROLL_OR_ACTION_BUDGET_REACHED',
    );
  }
  for (const pending of page.actions.filter((candidate) =>
    actionPending(candidate, exploration),
  )) {
    await addLimit('ACTION_LIMIT_REACHED');
    await services.recordUnobserved(
      id,
      task.id,
      `${pending.kind}-remaining`,
      'ACTION_BUDGET_REACHED',
    );
  }
  if (focusedAction(page.actions, { ...exploration, focusCount: 0 }))
    await services.recordUnobserved(
      id,
      task.id,
      'remaining-focus-states',
      'FOCUS_SAMPLE_OR_ACTION_LIMIT_REACHED',
    );
  if (
    page.actions.some(
      (candidate) =>
        candidate.kind === 'carousel' &&
        (exploration.attempts.get(candidate.id) ?? 0) >= 4,
    )
  )
    await services.recordUnobserved(
      id,
      task.id,
      'remaining-carousel-states',
      'CAROUSEL_TRANSITION_LIMIT_REACHED',
    );
  if (!job.advancedPointer)
    await services.recordUnobserved(
      id,
      task.id,
      'hover-states',
      'TRUSTED_POINTER_DRIVER_NOT_ENABLED',
    );
  else if (hoveredAction(page.actions, { ...exploration, hoverCount: 0 }))
    await services.recordUnobserved(
      id,
      task.id,
      'remaining-hover-states',
      'HOVER_SAMPLE_LIMIT_REACHED',
    );
  // Keep recording through the late window itself. A timer outside a
  // capture segment would miss precisely the delayed effect we seek.
  await services.observe(
    id,
    generation,
    task.id,
    'delayed-state',
    DELAYED_OBSERVATION_MS,
    undefined,
    undefined,
    () =>
      replayReliable
        ? replayScenario(
            task.url,
            initialViewport,
            recipeSteps,
            DELAYED_OBSERVATION_MS,
          )
        : undefined,
  );
  if (reserveCompact && actionCount < job.limits.maxActionsPerRoute) {
    let compactPhase = 'compact-viewport';
    let measurementAttempted = false;
    try {
      // Re-load the route before another viewport profile: this
      // resets interactions and makes its recipe independent and repeatable.
      await services.loadRoute(
        id,
        generation,
        task.url,
        task.id,
        task.navigationSource,
        task.navigationScrollY,
      );
      const method = 'PHYSICAL';
      await services.recordUnobserved(
        id,
        task.id,
        'compact-resize-transition',
        'VIEWPORT_NEGOTIATION_PRECEDES_MEASUREMENT',
      );
      const compact = await services.resizeViewport(
        id,
        generation,
        {
          width: 600,
          height: Math.min(720, initialViewport.height),
          dpr: initialViewport.dpr,
        },
        method,
      );
      const reset = await services.content<{ achieved: boolean }>(
        id,
        generation,
        'FG_SCROLL',
        { y: 0 },
      );
      if (!reset.achieved) throw new Error('COMPACT_INITIAL_SCROLL_UNREACHED');
      measurementAttempted = true;
      const compactObserved = await services.observe(
        id,
        generation,
        task.id,
        'compact-viewport',
        5_000,
        undefined,
        undefined,
        () =>
          replayScenario(
            task.url,
            compact.viewport,
            [],
            5_000,
            'compact',
            undefined,
            method,
          ),
      );
      actionCount++;
      if (!compactObserved)
        throw new Error('COMPACT_VIEWPORT_OBSERVATION_UNREACHED');
      compactPhase = 'compact-controls';
      measurementAttempted = false;
      const compactPage = await services.content<PageInventory>(
        id,
        generation,
        'FG_INVENTORY',
      );
      if (
        compactPage.mediaPresent ||
        compactPage.actions.some((action) => action.kind === 'media')
      ) {
        await services.recordUnobserved(
          id,
          task.id,
          'compact-media-loop-boundaries',
          'COMPACT_SINGLE_INTERACTION_SAMPLE_LIMIT',
        );
        await services.recordUnobserved(
          id,
          task.id,
          'compact-video-expanded-or-fullscreen',
          'EXPANDED_MEDIA_DISPLAY_NOT_IMPLEMENTED_IN_BACKGROUND_RUNNER',
        );
      }
      const responsive =
        compactPage.actions.find(
          (action) => action.kind === 'consent-reject',
        ) ?? compactPage.actions.find((action) => action.target);
      if (responsive && actionCount < job.limits.maxActionsPerRoute) {
        const duration = responsive.kind === 'media' ? 15_000 : 5_000;
        const compactSteps: ReplayStep[] = [
          { kind: 'wait', durationMs: 5_000 },
        ];
        measurementAttempted = true;
        await services.observe(
          id,
          generation,
          task.id,
          `compact-${responsive.kind}`,
          duration,
          async () => {
            const result = await services.content<{
              achieved: boolean;
              reason?: string;
              state?: string;
            }>(id, generation, 'FG_ACTION', {
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
                  task.url,
                  compact.viewport,
                  compactSteps,
                  duration,
                  'compact',
                  1,
                  method,
                )
              : undefined,
        );
        actionCount++;
        await services.recordUnobserved(
          id,
          task.id,
          'compact-additional-states',
          'COMPACT_SINGLE_INTERACTION_SAMPLE_LIMIT',
        );
      } else if (responsive) {
        await services.recordUnobserved(
          id,
          task.id,
          'compact-controls',
          'ACTION_BUDGET_REACHED',
        );
      }
    } catch (error) {
      // observe() already persists the attempted segment in finally,
      // even if native geometry negotiation fails before BEGIN.
      if (!measurementAttempted)
        await services.recordUnobserved(
          id,
          task.id,
          compactPhase,
          services.errorText(error),
          'UNREACHED',
        );
      if (compactPhase === 'compact-viewport')
        await services.recordUnobserved(
          id,
          task.id,
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
          services.workspace.emulatedViewports.has(id) ||
          services.workspace.restoreWindows.has(id) ||
          services.workspace.viewportWorkspaces.has(id)
        )
          await services.releaseCaptureSource(id, generation);
      } finally {
        await services.restoreEmulation(id);
        await services.restoreWindow(id);
        const afterCompact = await getJob(id);
        // Keep the final owned workspace active behind its cover until
        // terminal cleanup removes browser chrome. Between routes the
        // debugger and the previous attached-geometry contract remain.
        if (
          !services.workspace.pointerSessions.has(id) ||
          (afterCompact && nextTask(afterCompact))
        )
          await services.restoreWorkspace(id);
        await services.recordUnownedWorkspace(id);
      }
    }
  } else if (reserveCompact) {
    await services.recordUnobserved(
      id,
      task.id,
      'compact-viewport',
      'ACTION_BUDGET_REACHED',
    );
  }
}
