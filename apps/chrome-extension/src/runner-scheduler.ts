import { normalizePublicUrl } from '@epi-less/core';
import {
  TERMINAL_STATES,
  viewportDuration,
  type PageInventory,
  type ReplayStep,
} from './model';
import { exploreRoute } from './runner-exploration';
import {
  computeCompletion,
  enqueueRoutes,
  hasHashRoute,
  mergePreviouslyMeasuredRoute,
  nextTask,
  registerReachedRoute,
} from './runner-policy';
import type { SchedulerServices } from './runner-services';
import { replayScenario } from './scenario-plan';
import { discoverSitemap } from './sitemap';
import { getJob, mutateJob } from './store';

// Worker services are injected lazily; module construction never starts a scan.
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
              continue;
            }
          } else
            await services.loadRoute(
              id,
              generation,
              task.url,
              task.id,
              task.navigationSource,
            );
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
              (hasHashRoute(page.url) ||
                normalizePublicUrl(page.url) !== task.url)
            ) {
              await mutateJob(id, (state) => {
                enqueueRoutes(state, [page.url], task);
              });
              throw new Error('ROUTE_CHANGED_BETWEEN_SCENARIOS');
            }
            await mutateJob(id, (state) => {
              const current = state.tasks.find(
                (value) => value.id === task.id,
              )!;
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
              job.mode === 'EXTENDED'
                ? 'extended-viewport'
                : 'initial-viewport',
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
                hasDiscoveredVideo: () => discoveredVideo,
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
              [
                'RUNNER_CANCELLED',
                'ORIGIN_CHANGED',
                'PERMISSION_REVOKED',
              ].includes(reason) ||
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
        if (job.mode !== 'AUTONOMOUS') break;
        await services.guardedWait(id, generation, 750);
      }
    } catch (error) {
      stopReason = services.errorText(error);
    } finally {
      // Cancellation and targeted replay must release the browser producer too;
      // track.stop() alone can leave its size constraints active during restore.
      try {
        await services.releaseCaptureSource(id, generation);
      } catch {
        stopReason = 'CAPTURE_SOURCE_RELEASE_UNCONFIRMED';
        await mutateJob(id, (job) => {
          if (!job.limitations.includes('CAPTURE_SOURCE_RELEASE_UNCONFIRMED'))
            job.limitations.push('CAPTURE_SOURCE_RELEASE_UNCONFIRMED');
        });
      }
      await services
        .offscreen('CAPTURE_STOP', { generation })
        .catch(() => undefined);
      services.capture.capturePixelRatios.delete(id);
      services.capture.captureSources.delete(id);
      const cleanupJob = await getJob(id);
      if (cleanupJob?.disposableSource) {
        if (cleanupJob.state === 'PAUSED') {
          await services.restoreEmulation(id);
          await services.restoreWorkspace(id);
        }
      } else {
        await services.restoreEmulation(id);
        try {
          await services.ensureTerminalDebuggerWorkspace(id, generation);
        } catch (error) {
          await mutateJob(id, (state) => {
            state.limitations.push(
              `DEBUGGER_VIEWPORT_RESTORE_UNCONFIRMED: ${services.errorText(error)}`,
            );
            state.stopIntent = true;
            if (!TERMINAL_STATES.includes(state.state)) {
              state.state = 'INTERRUPTED';
              state.stopReason = 'DEBUGGER_VIEWPORT_RESTORE_UNCONFIRMED';
              state.endedAt = services.now();
            }
          });
        }
        await services.restoreWorkspace(
          id,
          services.workspace.pointerSessions.has(id),
        );
        await services.recordUnownedWorkspace(id);
      }
      const session = services.workspace.pointerSessions.get(id);
      if (session) {
        try {
          await services.releasePointerOwner(id, session);
        } catch (error) {
          await mutateJob(id, (state) => {
            state.limitations.push(
              `DEBUGGER_RELEASE_UNCONFIRMED: ${services.errorText(error)}`,
            );
          });
        }
      }
      await services.restoreWindow(id);
      const existing = await getJob(id);
      if (existing)
        await chrome.tabs
          .sendMessage(existing.tabId, { type: 'FG_RESTORE' })
          .catch(() => undefined);
      await mutateJob(id, (state) => {
        if (
          state.generation !== generation ||
          ['PAUSED', 'INTERRUPTED', 'ERROR'].includes(state.state)
        )
          return;
        if (state.stopIntent || state.state === 'STOPPING') {
          state.state = 'PARTIAL';
          state.stopReason ??= 'USER_STOP';
        } else if (stopReason === 'QUEUE_EXHAUSTED') {
          state.state = computeCompletion(state);
          state.stopReason = stopReason;
        } else {
          state.state = ['BUDGET_REACHED'].includes(stopReason)
            ? 'PARTIAL'
            : 'INTERRUPTED';
          state.stopReason = stopReason;
        }
        state.endedAt = services.now();
      });
      await services.finalizeAdvancedJob(id, generation);
      await chrome.action.setBadgeText({ text: '' });
      services.execution.clearClock(generation);
    }
  }
  return { runJob };
}
