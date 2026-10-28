import { enqueueRoutes, nextTask } from './runner-policy';

import type { SchedulerServices } from './runner-services';

import { discoverSitemap } from './sitemap';

import { finalizeScheduledJob } from './scheduler-finalization';
import { runScheduledRoute } from './scheduler-route';
import { mutateJob } from './store';

// Worker services are injected lazily; module construction never starts a scan.
/** Run queued work under the current lease and finalize capture ownership on every exit. */
export function createRunnerScheduler(services: SchedulerServices) {
  async function runJob(id: string, generation: string) {
    let stopReason = 'QUEUE_EXHAUSTED';
    try {
      const initial = await services.guard(id, generation);
      if (initial.advancedPointer) {
        if (
          services.workspace.pointerSessions.get(id)?.generation !== generation
        )
          throw new Error('CDP_VIEWPORT_SESSION_UNAVAILABLE');
      }
      // The first navigation observation starts on the current document. It also
      // needs a trusted pre-action viewport before the destination is instrumented.
      await services.guard(id, generation);
      await chrome.scripting.executeScript({
        target: { tabId: initial.tabId },
        files: ['content.js'],
      });
      await services.guard(id, generation);
      if (
        initial.mode === 'AUTONOMOUS' &&
        !initial.replayTarget &&
        !initial.sitemapChecked
      ) {
        const sitemap = await discoverSitemap(initial.origin, () =>
          services.guard(id, generation),
        );
        await mutateJob(id, (state) => {
          state.sitemapChecked = true;
          enqueueRoutes(state, sitemap.urls, state.tasks[0]);
          state.limitations = [
            ...new Set([...state.limitations, ...sitemap.limitations]),
          ];
        });
      }
      while (true) {
        const job = await services.guard(id, generation);
        const task = nextTask(job);
        if (!task) break;
        await mutateJob(id, (state) => {
          state.tasks.find((value) => value.id === task.id)!.state = 'RUNNING';
        });
        if (
          (await runScheduledRoute(services, id, generation, job, task)) ===
          'MERGED'
        )
          continue;
        if (job.mode !== 'AUTONOMOUS') break;
        await services.guardedWait(id, generation, 750);
      }
    } catch (error) {
      stopReason = services.errorText(error);
    } finally {
      await finalizeScheduledJob(services, id, generation, stopReason);
    }
  }
  return { runJob };
}
