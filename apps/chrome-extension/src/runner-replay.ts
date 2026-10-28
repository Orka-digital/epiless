import { normalizePublicUrl } from '@epi-less/core';
import {
  type PageInventory,
  type ReplayScenario,
  type ReplayStep,
} from './model';
import type { RunnerOperations } from './runner-contracts';
import { sameViewport } from './scenario-plan';
import { trustedHover } from './trusted-pointer';

import type { ObservationServices } from './observation-services';
/** Execute a stored recipe only after route, viewport and media preconditions have been checked. */
export function createRunnerReplay(
  services: ObservationServices,
  observe: RunnerOperations['observe'],
) {
  async function executeReplayStep(
    id: string,
    generation: string,
    step: ReplayStep,
  ) {
    const job = await services.guard(id, generation);
    if (step.kind === 'wait') {
      await services.guardedWait(
        id,
        generation,
        step.durationMs,
        job.replayTarget?.route,
      );
      return { achieved: true };
    }
    const result =
      step.kind === 'hover'
        ? await hoverControl(id, generation, step.target)
        : await services.content<{
            achieved: boolean;
            reason?: string;
            state?: string;
          }>(
            id,
            generation,
            step.kind === 'scroll'
              ? 'FG_SCROLL'
              : step.kind === 'focus'
                ? 'FG_FOCUS'
                : 'FG_ACTION',
            step.kind === 'scroll'
              ? { y: step.y }
              : { target: step.target, expectedState: step.expectedState },
          );
    if (
      result.achieved &&
      'expectedState' in step &&
      step.expectedState &&
      result.state !== step.expectedState
    )
      return { achieved: false, reason: 'REPLAY_CONTROL_STATE_MISMATCH' };
    return result;
  }
  async function hoverControl(
    id: string,
    generation: string,
    target: import('./model').ReplayTarget,
  ) {
    const job = await services.guard(id, generation);
    return trustedHover({
      enabled:
        job.advancedPointer === true &&
        chrome.runtime.getManifest().permissions?.includes('debugger') === true,
      tabId: job.tabId,
      target,
      guard: () => services.guard(id, generation),
      request: (type, target) =>
        services.content(id, generation, type, { target }),
      ownsDebuggerSession:
        services.workspace.pointerSessions.get(id)?.generation === generation,
    });
  }
  async function runReplay(
    id: string,
    generation: string,
    taskId: string,
    target: ReplayScenario,
  ) {
    let page = await services.content<PageInventory>(
      id,
      generation,
      'FG_INVENTORY',
    );
    if (
      target.viewportMethod === 'CDP' ||
      !sameViewport(target.viewport, page.viewport)
    ) {
      await services.recordUnobserved(
        id,
        taskId,
        'replay-viewport-transition',
        'VIEWPORT_NEGOTIATION_PRECEDES_MEASUREMENT',
      );
      page = await services.resizeViewport(
        id,
        generation,
        target.viewport,
        target.viewportMethod ?? 'PHYSICAL',
      );
    }
    if (normalizePublicUrl(page.url) !== target.route)
      throw new Error('REPLAY_ROUTE_NOT_REACHED');
    const prerequisites =
      target.measuredStep === undefined
        ? target.steps
        : target.steps.slice(0, target.measuredStep);
    for (const [index, step] of prerequisites.entries()) {
      const result = await executeReplayStep(id, generation, step);
      if (!result.achieved)
        throw new Error(
          `REPLAY_PREREQUISITE_${index + 1}_UNREACHED: ${result.reason}`,
        );
    }
    const actual = await services.content<PageInventory>(
      id,
      generation,
      'FG_INVENTORY',
    );
    if (!sameViewport(target.viewport, actual.viewport))
      throw new Error('REPLAY_VIEWPORT_CHANGED');
    const mediaPrepared =
      target.mediaPlan &&
      (await services
        .content<{ achieved: boolean }>(
          id,
          generation,
          'FG_MEDIA_REPLAY_PREPARE',
          { mediaPlan: target.mediaPlan },
          3500,
        )
        .catch(() => undefined));
    await observe(
      id,
      generation,
      taskId,
      'targeted-recheck',
      target.durationMs,
      target.measuredStep === undefined
        ? undefined
        : () =>
            executeReplayStep(
              id,
              generation,
              target.steps[target.measuredStep!],
            ),
      undefined,
      () => structuredClone(target),
      {
        plan: target.mediaPlan,
        prepared: mediaPrepared?.achieved === true,
        preserveRecipe: true,
      },
      target.phasePlan,
    );
  }
  return { executeReplayStep, hoverControl, runReplay };
}
