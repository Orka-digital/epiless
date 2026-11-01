import { TERMINAL_STATES } from './model';

import type { RunnerOperations } from './runner-contracts';

import { mutateJob } from './store';

import { detachPointerSessionAndConfirm } from './trusted-pointer';

import {
  restoreEmulatedViewport,
  waitForStableViewport,
} from './viewport-driver';

import type { CaptureServices } from './runner-capture-services';
import {
  finalizeWorkspaceOwnership,
  restoreViewportWorkspace,
} from './viewport-workspace';
/** Restore browser geometry and retain unresolved ownership for manual recovery. */
export function createCaptureRestoration(
  services: CaptureServices,
  dependencies: Pick<RunnerOperations, 'releasePointerOwner'>,
) {
  async function restoreEmulation(id: string) {
    const previous = services.workspace.emulatedViewports.get(id);
    if (!previous) return;
    services.workspace.emulatedViewports.delete(id);
    const session = services.workspace.pointerSessions.get(id);
    try {
      if (!session) throw new Error('CDP_VIEWPORT_SESSION_UNAVAILABLE');
      await restoreEmulatedViewport(session.tabId, previous);
      await waitForStableViewport({
        expected: previous,
        read: async () => {
          const reply = await services.timed(
            chrome.tabs.sendMessage(session.tabId, {
              type: 'FG_DIAGNOSTIC_CONTEXT',
            }),
            1500,
          );
          if (!reply?.ok)
            throw new Error('CDP_VIEWPORT_RESTORE_CONTEXT_UNAVAILABLE');
          return reply.value.viewport;
        },
        wait: services.sleep,
      });
    } catch {
      await mutateJob(id, (job) => {
        if (!job.limitations.includes('CDP_VIEWPORT_RESTORE_UNCONFIRMED'))
          job.limitations.push('CDP_VIEWPORT_RESTORE_UNCONFIRMED');
        // Do not continue later routes in a viewport whose restoration is unknown.
        job.stopIntent = true;
        if (!TERMINAL_STATES.includes(job.state)) {
          job.state = 'INTERRUPTED';
          job.stopReason = 'CDP_VIEWPORT_RESTORE_UNCONFIRMED';
          job.endedAt = services.now();
        }
      });
    }
  }

  async function restoreWorkspace(id: string, releaseDebugger = false) {
    const workspace = services.workspace.viewportWorkspaces.get(id);
    if (!workspace) return;
    // Guard checks must not prevent terminal cleanup, including an explicit stop.
    services.workspace.viewportWorkspaces.delete(id);
    try {
      await restoreViewportWorkspace({
        workspace,
        read: async () => {
          const reply = await services.timed(
            chrome.tabs.sendMessage(workspace.tabId, {
              type: 'FG_DIAGNOSTIC_CONTEXT',
            }),
            1500,
          );
          if (!reply?.ok)
            throw new Error('VIEWPORT_WORKSPACE_CONTEXT_UNAVAILABLE');
          return reply.value.viewport;
        },
        wait: services.sleep,
        ...(releaseDebugger
          ? {
              releaseDebugger: async () => {
                const session = services.workspace.pointerSessions.get(id);
                if (session)
                  await dependencies.releasePointerOwner(id, session);
                else await detachPointerSessionAndConfirm(workspace.tabId);
              },
            }
          : {}),
      });
    } catch (error) {
      await mutateJob(id, (job) => {
        job.limitations.push(
          `VIEWPORT_WORKSPACE_RESTORE_UNCONFIRMED: ${services.errorText(error)}`,
        );
        job.stopIntent = true;
        if (!TERMINAL_STATES.includes(job.state)) {
          job.state = 'INTERRUPTED';
          job.stopReason = 'VIEWPORT_WORKSPACE_RESTORE_UNCONFIRMED';
          job.endedAt = services.now();
        }
      });
    } finally {
      await finalizeWorkspaceOwnership({
        workspace,
        locate: async () =>
          (await chrome.tabs.query({})).find(
            (tab) => tab.id === workspace.tabId,
          ),
        clear: () =>
          chrome.storage.session.remove([
            services.workspaceKey(id),
            services.workspaceIntentKey(id),
          ]),
        downgrade: async (intent) => {
          // A single storage mutation revokes automatic authority and preserves
          // manual placement data even if the worker dies before remove().
          await chrome.storage.session.set({
            [services.workspaceKey(id)]: null,
            [services.workspaceIntentKey(id)]: intent,
          });
          await chrome.storage.session.remove(services.workspaceKey(id));
        },
      });
    }
  }

  async function restoreWindow(id: string) {
    const original = services.workspace.restoreWindows.get(id);
    if (!original) return;
    services.workspace.restoreWindows.delete(id);
    await chrome.windows
      .update(original.id, {
        width: original.width,
        height: original.height,
        ...(original.left === undefined ? {} : { left: original.left }),
        ...(original.top === undefined ? {} : { top: original.top }),
      })
      .catch(() => undefined);
  }
  return { restoreEmulation, restoreWorkspace, restoreWindow };
}
