import { getJob, mutateJob } from './store';

import type { CaptureServices } from './runner-capture-services';
import {
  createDebuggerRestoreWorkspace,
  type ViewportMoveIntent,
} from './viewport-workspace';
/** Reconcile workspace receipts without guessing ownership from surviving tabs. */
export function createCaptureWorkspace(services: CaptureServices) {
  async function ensureTerminalDebuggerWorkspace(
    id: string,
    generation: string,
  ) {
    const session = services.workspace.pointerSessions.get(id);
    if (!session || services.workspace.viewportWorkspaces.has(id)) return;
    if (!session.restore)
      throw new Error('VIEWPORT_PRE_DEBUGGER_GEOMETRY_UNAVAILABLE');
    const tab = await chrome.tabs.get(session.tabId);
    // An already-active user tab can reflow on detach itself. Never move it away
    // from the user merely to reproduce the automated background-window path.
    if (tab.active) return;
    await createDebuggerRestoreWorkspace({
      tabId: session.tabId,
      baseline: session.restore,
      guard: async () => {
        if (
          services.workspace.pointerSessions.get(id) !== session ||
          session.generation !== generation ||
          (await getJob(id))?.generation !== generation
        )
          throw new Error('DEBUGGER_RESTORE_OWNERSHIP_CHANGED');
        if (
          (await chrome.tabCapture.getCapturedTabs()).some(
            (value) =>
              value.tabId === session.tabId &&
              ['active', 'pending'].includes(value.status),
          )
        )
          throw new Error('CAPTURE_SOURCE_RELEASE_UNCONFIRMED');
      },
      read: async () => {
        const reply = await services.timed(
          chrome.tabs.sendMessage(session.tabId, {
            type: 'FG_DIAGNOSTIC_CONTEXT',
          }),
          1500,
        );
        if (!reply?.ok)
          throw new Error('VIEWPORT_WORKSPACE_CONTEXT_UNAVAILABLE');
        return reply.value.viewport;
      },
      wait: services.sleep,
      rememberIntent: async (intent) => {
        await chrome.storage.session.set({
          [services.workspaceIntentKey(id)]: intent,
        });
      },
      remember: async (workspace) => {
        services.workspace.viewportWorkspaces.set(id, workspace);
        await chrome.storage.session.set({
          [services.workspaceKey(id)]: workspace,
        });
        await chrome.storage.session.remove(services.workspaceIntentKey(id));
      },
    });
  }

  async function unresolvedWorkspaceIntent(
    id: string,
  ): Promise<ViewportMoveIntent | undefined> {
    const intent = (
      await chrome.storage.session.get(services.workspaceIntentKey(id))
    )[services.workspaceIntentKey(id)] as ViewportMoveIntent | undefined;
    if (!intent) return;
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = (await chrome.tabs.query({})).find(
        (value) => value.id === intent.tabId,
      );
    } catch {
      return intent;
    }
    if (!tab || tab.windowId === intent.originalWindowId) {
      await chrome.storage.session.remove(services.workspaceIntentKey(id));
      return;
    }
    // An intent is not an owned-window lease. Never guess where the user tab went.
    return intent;
  }

  async function recordUnownedWorkspace(id: string) {
    if (!(await unresolvedWorkspaceIntent(id))) return;
    await mutateJob(id, (job) => {
      if (
        !job.limitations.includes('VIEWPORT_WORKSPACE_MANUAL_RESTORE_REQUIRED')
      )
        job.limitations.push('VIEWPORT_WORKSPACE_MANUAL_RESTORE_REQUIRED');
      job.stopIntent = true;
      job.state = 'INTERRUPTED';
      job.stopReason = 'VIEWPORT_WORKSPACE_MANUAL_RESTORE_REQUIRED';
      job.endedAt = services.now();
    });
  }
  return {
    ensureTerminalDebuggerWorkspace,
    unresolvedWorkspaceIntent,
    recordUnownedWorkspace,
  };
}
