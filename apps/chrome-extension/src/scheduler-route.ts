import { normalizePublicUrl } from '@epi-less/core';

import { viewportDuration, type ReplayStep } from './model';

import { exploreRoute } from './runner-exploration';

import {
  mergePreviouslyMeasuredRoute,
  registerReachedRoute,
} from './runner-policy';

import type { SchedulerServices } from './runner-services';

import { replayScenario } from './scenario-plan';

import { createRouteInventory } from './scheduler-inventory';
import { mutateJob } from './store';

/** Navigate and measure one queued route under its execution generation; persist explicit route failures. */
export async function runScheduledRoute(
  services: SchedulerServices,
  id: string,
  generation: string,
  job: import('./model').ScanJob,
  task: import('./model').RouteTask,
) {
  try {
    if (job.mode === 'AUTONOMOUS') {
      const tab = await chrome.tabs.get(job.tabId);
      const navigation = {
        from: normalizePublicUrl(tab.url ?? job.startUrl),
        to: normalizePublicUrl(task.url),
      };
      await mutateJob(id, (state) => {
        state.tasks
          .find((value) => value.id === task.id)!
          .reasons.push(
            `Navigation transition from ${navigation.from} to ${navigation.to}; includes prior-page frames. Findings in navigation-transition cannot be attributed solely to the destination.`,
          );
      });
      await services.observe(
        id,
        generation,
        task.id,
        'navigation-transition',
        1000,
        async () => {
          const reached = await services.loadRoute(
            id,
            generation,
            task.url,
            task.id,
            task.navigationSource,
            task.navigationScrollY,
          );
          await mutateJob(id, (state) => {
            registerReachedRoute(state, task.id, reached);
          });
          task.url = reached;
          navigation.to = reached;
          return { achieved: true };
        },
        navigation,
      );
      let merged = false;
      await mutateJob(id, (state) => {
        merged = mergePreviouslyMeasuredRoute(state, task.id);
      });
      if (merged) {
        await services.guardedWait(id, generation, 750);
        return 'MERGED' as const;
      }
    } else
      await services.loadRoute(
        id,
        generation,
        task.url,
        task.id,
        task.navigationSource,
      );
    const { inventory, hasDiscoveredVideo } = createRouteInventory(
      services,
      id,
      generation,
      job,
      task,
    );
    const page = await inventory();
    if (job.replayTarget) {
      await services.runReplay(id, generation, task.id, job.replayTarget);
    } else {
      const recipeSteps: ReplayStep[] = [];

      const initialViewport = { ...page.viewport };
      const initialDuration =
        job.viewportDurationMs ?? viewportDuration(job.mode);
      await services.observe(
        id,
        generation,
        task.id,
        job.mode === 'EXTENDED' ? 'extended-viewport' : 'initial-viewport',
        initialDuration,
        undefined,
        undefined,
        () =>
          replayScenario(
            task.url,
            initialViewport,
            recipeSteps,
            initialDuration,
          ),
      );
      recipeSteps.push({ kind: 'wait', durationMs: initialDuration });
      if (job.mode === 'AUTONOMOUS') {
        await exploreRoute(services, {
          id,
          generation,
          job,
          task,
          page,
          initialViewport,
          recipeSteps,
          inventory,
          hasDiscoveredVideo,
        });
      }
    }
    await services.content(id, generation, 'FG_RESTORE');
    await mutateJob(id, (state) => {
      const current = state.tasks.find((value) => value.id === task.id)!;
      current.state = current.observations.every(
        (value) =>
          value.achieved &&
          value.measurement &&
          value.measurement.quality.frameCount >= 2 &&
          value.measurement.quality.effectiveFps >= 50 &&
          value.measurement.quality.maxGapMs <= 100 &&
          !value.measurement.quality.interrupted,
      )
        ? 'OBSERVED'
        : 'PARTIAL';
    });
  } catch (error) {
    const reason = services.errorText(error);
    if (job.replayTarget)
      await services.recordUnobserved(
        id,
        task.id,
        'targeted-recheck-unreached',
        reason,
        'UNREACHED',
      );
    await mutateJob(id, (state) => {
      const current = state.tasks.find((value) => value.id === task.id)!;
      current.state = current.observations.length ? 'PARTIAL' : 'SKIPPED';
      current.reasons.push(reason);
      if (
        ['RUNNER_CANCELLED', 'ORIGIN_CHANGED', 'PERMISSION_REVOKED'].includes(
          reason,
        ) ||
        /Capture|CAPTURE|capture/.test(reason)
      )
        state.interruptedTaskId = task.id;
    });
    if (
      [
        'RUNNER_CANCELLED',
        'BUDGET_REACHED',
        'ORIGIN_CHANGED',
        'PERMISSION_REVOKED',
      ].includes(reason) ||
      /Capture|CAPTURE|capture/.test(reason)
    )
      throw error;
  }
}
