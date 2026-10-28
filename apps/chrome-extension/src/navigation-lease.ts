import { type ScanJob } from './model';

import { assertLease, observationRouteChanged } from './runner-policy';

import { getJob, mutateJob } from './store';

import type { NavigationServices } from './runner-navigation-services';
import { assertViewportWorkspace } from './viewport-workspace';
/** Validate the active lease around bounded waits and content requests. */
export function createNavigationLease(services: NavigationServices) {
  async function guard(id: string, generation: string): Promise<ScanJob> {
    if (
      services.execution.clock?.id === id &&
      services.execution.clock.generation === generation
    ) {
      const activeClock = services.execution.clock;
      await mutateJob(id, (state) => {
        if (state.state === 'RUNNING' && state.generation === generation)
          state.elapsedMs =
            activeClock.priorMs +
            Math.max(0, performance.now() - activeClock.started);
      });
    }
    const job = await getJob(id);
    assertLease(job, generation);
    if (job.elapsedMs >= job.limits.maxDurationMs)
      throw new Error('BUDGET_REACHED');
    const tab = await chrome.tabs.get(job.tabId);
    if (!tab.url || new URL(tab.url).origin !== job.origin)
      throw new Error('ORIGIN_CHANGED');
    if (!(await chrome.permissions.contains({ origins: [`${job.origin}/*`] })))
      throw new Error('PERMISSION_REVOKED');
    const workspace = services.workspace.viewportWorkspaces.get(id);
    if (workspace) await assertViewportWorkspace(workspace);
    return job;
  }

  async function guardedWait(
    id: string,
    generation: string,
    duration: number,
    expectedRoute?: string,
  ) {
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) {
      const job = await guard(id, generation);
      if (expectedRoute) {
        const actual = (await chrome.tabs.get(job.tabId)).url ?? '';
        if (observationRouteChanged(expectedRoute, actual))
          throw new Error('ROUTE_CHANGED_DURING_OBSERVATION');
      }
      const step = Math.min(400, deadline - Date.now());
      if (step > 0) await services.sleep(step);
    }
  }

  async function content<T>(
    id: string,
    generation: string,
    type: string,
    values: Record<string, unknown> = {},
    timeoutMs = 7_000,
  ): Promise<T> {
    const job = await guard(id, generation);
    const result = await services.timed(
      chrome.tabs.sendMessage(job.tabId, { type, ...values }),
      timeoutMs,
    );
    if (!result?.ok)
      throw new Error(result?.error ?? 'Page instrumentation did not answer');
    return result.value;
  }
  return { guard, guardedWait, content };
}
