import { normalizePublicUrl } from '@epi-less/core';

import { type PageInventory } from './model';

import { enqueueRoutes, hasHashRoute } from './runner-policy';

import type { SchedulerServices } from './runner-services';

import { mutateJob } from './store';

/** Build a lease-guarded inventory reader that accumulates discovered video context for this route. */
export function createRouteInventory(
  services: SchedulerServices,
  id: string,
  generation: string,
  job: import('./model').ScanJob,
  task: import('./model').RouteTask,
) {
  let discoveredVideo = false;
  const inventory = async () => {
    const page = await services.content<PageInventory>(
      id,
      generation,
      'FG_INVENTORY',
    );
    if (
      !discoveredVideo &&
      !job.replayTarget &&
      job.mode === 'AUTONOMOUS' &&
      (page.mediaPresent ||
        page.actions.some((candidate) => candidate.kind === 'media'))
    ) {
      discoveredVideo = true;
      // A bounded inline playback is not evidence that the loop seam or
      // the largest display scale was exercised. Persist these gaps even
      // if a later action fails and the route does not reach its end.
      await services.recordUnobserved(
        id,
        task.id,
        'video-expanded-or-fullscreen',
        'EXPANDED_MEDIA_DISPLAY_NOT_IMPLEMENTED_IN_BACKGROUND_RUNNER',
      );
    }
    if (
      job.mode === 'AUTONOMOUS' &&
      (hasHashRoute(page.url) || normalizePublicUrl(page.url) !== task.url)
    ) {
      await mutateJob(id, (state) => {
        enqueueRoutes(state, [page.url], task);
      });
      throw new Error('ROUTE_CHANGED_BETWEEN_SCENARIOS');
    }
    await mutateJob(id, (state) => {
      const current = state.tasks.find((value) => value.id === task.id)!;
      current.viewport = page.viewport;
      const viewportReason = `Viewport at route inventory: ${page.viewport.width} × ${page.viewport.height} CSS pixels; device pixel ratio ${page.viewport.dpr}.`;
      if (!current.reasons.includes(viewportReason))
        current.reasons.push(viewportReason);
      if (state.mode === 'AUTONOMOUS' && !state.replayTarget)
        enqueueRoutes(state, page.links, current, true, page.scrollY);
      state.limitations = [
        ...new Set([...state.limitations, ...page.limitations]),
      ];
    });
    return page;
  };
  return { inventory, hasDiscoveredVideo: () => discoveredVideo };
}
