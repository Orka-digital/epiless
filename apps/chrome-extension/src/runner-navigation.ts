import { normalizePublicUrl, planRoute } from '@epi-less/core';
import { type PageInventory, type ScanJob } from './model';
import { navigateDiscoveredRoute } from './navigation';
import type { RunnerOperations } from './runner-contracts';
import {
  assertLease,
  hasHashRoute,
  observationRouteChanged,
} from './runner-policy';
import type { ExecutionOwner, WorkspaceOwner } from './runner-runtime';
import { getJob, mutateJob } from './store';
import { assertViewportWorkspace } from './viewport-workspace';

// Worker services are injected lazily; module construction never starts a scan.
export function createRunnerNavigation(
  services: Pick<RunnerOperations, 'sleep' | 'timed'> & {
    execution: ExecutionOwner;
    workspace: WorkspaceOwner;
  },
) {
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
  async function loadRoute(
    id: string,
    generation: string,
    url: string,
    taskId: string,
    source?: string,
    sourceScrollY = 0,
  ): Promise<string> {
    const job = await guard(id, generation);
    const decision = planRoute({
      candidate: url,
      baseUrl: job.startUrl,
      origin: job.origin,
      depth: 0,
    });
    if (!decision.allowed) throw new Error(`ROUTE_BLOCKED: ${decision.reason}`);
    if (job.mode !== 'AUTONOMOUS' && !job.replayTarget) {
      await chrome.scripting.executeScript({
        target: { tabId: job.tabId },
        files: ['content.js'],
      });
      return url;
    }
    const deadline = Date.now() + 30_000;
    const navigationGuard = async () => {
      await guard(id, generation);
      if (Date.now() >= deadline) throw new Error('NAVIGATION_TIME_LIMIT');
    };
    const waitForReachedRoute = async (
      before: string,
      usedPageLink: boolean,
      documentCompleted = () => false,
    ): Promise<string> => {
      await guardedWait(id, generation, 150);
      while (Date.now() < deadline) {
        await navigationGuard();
        const tab = await chrome.tabs.get(job.tabId);
        if (
          tab.status === 'complete' &&
          (!usedPageLink || tab.url !== before || documentCompleted())
        ) {
          const actual = planRoute({
            candidate: tab.url ?? '',
            baseUrl: url,
            origin: job.origin,
            depth: 0,
          });
          if (!actual.allowed || !actual.url || hasHashRoute(tab.url ?? ''))
            throw new Error(`REDIRECT_UNOBSERVED: ${actual.reason}`);
          await chrome.scripting.executeScript({
            target: { tabId: job.tabId },
            files: ['content.js'],
          });
          const reset = await content<{ achieved: boolean }>(
            id,
            generation,
            'FG_SCROLL',
            { y: 0 },
          );
          if (!reset.achieved) throw new Error('INITIAL_SCROLL_UNOBSERVED');
          await guardedWait(id, generation, 600, actual.url);
          return actual.url;
        }
        await guardedWait(id, generation, 250);
      }
      throw new Error('NAVIGATION_TIME_LIMIT');
    };
    const activateLink = async (
      target: string,
    ): Promise<string | undefined> => {
      await navigationGuard();
      const before = (await chrome.tabs.get(job.tabId)).url ?? job.startUrl;
      let initiated: boolean;
      let documentStarted = false;
      let documentCompleted = false;
      const navigationListener = (
        tabId: number,
        info: chrome.tabs.OnUpdatedInfo,
      ) => {
        if (tabId !== job.tabId) return;
        if (info.status === 'loading') {
          documentStarted = true;
          documentCompleted = false;
        }
        if (info.status === 'complete' && documentStarted)
          documentCompleted = true;
      };
      chrome.tabs.onUpdated.addListener(navigationListener);
      try {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: job.tabId },
            files: ['content.js'],
          });
          initiated = (
            await content<{ initiated: boolean }>(
              id,
              generation,
              'FG_NAVIGATE',
              {
                url: target,
              },
            )
          ).initiated;
        } catch {
          // A full document navigation can close the message port. It may also
          // redirect back to the same URL; loading→complete proves it occurred.
          await navigationGuard();
          const tab = await chrome.tabs.get(job.tabId);
          initiated =
            documentStarted || tab.status === 'loading' || tab.url !== before;
        }
        return initiated
          ? await waitForReachedRoute(before, true, () => documentCompleted)
          : undefined;
      } finally {
        chrome.tabs.onUpdated.removeListener(navigationListener);
      }
    };
    return navigateDiscoveredRoute(url, source, {
      currentUrl: async () =>
        normalizePublicUrl(
          (await chrome.tabs.get(job.tabId)).url ?? job.startUrl,
        ),
      activateLink,
      openDocument: async (target, context) => {
        await navigationGuard();
        const allowed = planRoute({
          candidate: target,
          baseUrl: job.startUrl,
          origin: job.origin,
          depth: 0,
        });
        if (!allowed.allowed || !allowed.url || hasHashRoute(target))
          throw new Error('NAVIGATION_SOURCE_OUTSIDE_POLICY');
        const before = (await chrome.tabs.get(job.tabId)).url ?? job.startUrl;
        await chrome.tabs.update(job.tabId, { url: allowed.url });
        const reached = await waitForReachedRoute(before, false);
        if (context === 'source')
          await mutateJob(id, (state) => {
            state.tasks
              .find((task) => task.id === taskId)!
              .reasons.push(
                `Navigation restored discovery source ${reached} before activating its rendered link; this transition includes intermediate source-page frames.`,
              );
          });
        return reached;
      },
      revealAndActivateLink: async (target) => {
        const attempted = new Set<string>();
        let scrollRestored = sourceScrollY <= 0;
        // Reopen only supported navigation disclosures, never forms, media,
        // carousel controls or arbitrary buttons. Every action rechecks its policy.
        for (
          let step = 0;
          step <= Math.min(6, job.limits.maxActionsPerRoute);
          step++
        ) {
          const reached = await activateLink(target);
          if (reached !== undefined) return reached;
          if (step === Math.min(6, job.limits.maxActionsPerRoute)) break;
          const page = await content<PageInventory>(
            id,
            generation,
            'FG_INVENTORY',
          );
          const allowed = planRoute({
            candidate: page.url,
            baseUrl: job.startUrl,
            origin: job.origin,
            depth: 0,
          });
          if (!allowed.allowed || hasHashRoute(page.url))
            throw new Error('NAVIGATION_SOURCE_OUTSIDE_POLICY');
          const choices = page.actions.filter(
            (action) =>
              ['consent-reject', 'menu', 'accordion', 'tab'].includes(
                action.kind,
              ) && !attempted.has(action.id),
          );
          const consent = choices.find(
            (candidate) => candidate.kind === 'consent-reject',
          );
          if (!consent && !scrollRestored) {
            scrollRestored = true;
            await navigationGuard();
            const result = await content<{ achieved: boolean }>(
              id,
              generation,
              'FG_SCROLL',
              { y: Math.max(0, Math.min(sourceScrollY, 50_000)) },
            );
            if (!result.achieved)
              throw new Error('NAVIGATION_SOURCE_SCROLL_UNOBSERVED');
            // Scroll handlers and lazy insertion run asynchronously; retain the
            // same source identity while allowing that bounded reaction to settle.
            await guardedWait(id, generation, 350, page.url);
            continue;
          }
          const action = consent ?? choices[0];
          if (!action) break;
          attempted.add(action.id);
          await navigationGuard();
          await content(id, generation, 'FG_ACTION', { actionId: action.id });
          const actual = (await chrome.tabs.get(job.tabId)).url ?? '';
          if (observationRouteChanged(page.url, actual))
            throw new Error('NAVIGATION_SOURCE_CHANGED_DURING_CONTROL');
        }
        return undefined;
      },
    });
  }
  return { guard, guardedWait, content, loadRoute };
}
