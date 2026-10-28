import type { CaptureViewport } from './capture-quality';
import { reopenCaptureSource, waitForCaptureRelease } from './capture-source';
import {
  TERMINAL_STATES,
  type PageInventory,
  type ReplayScenario,
} from './model';
import type { RunnerOperations } from './runner-contracts';
import type { CaptureOwner, WorkspaceOwner } from './runner-runtime';
import type { PointerSession, StoredPointerSession } from './runner-types';
import { sameViewport } from './scenario-plan';
import { type DiagnosticContext } from './source-diagnostics';
import { getJob, mutateJob } from './store';
import {
  detachPointerSessionAndConfirm,
  releaseOwnedPointerSession,
} from './trusted-pointer';
import {
  resizeCapturedViewport,
  restoreEmulatedViewport,
  waitForStableViewport,
} from './viewport-driver';
import {
  createDebuggerRestoreWorkspace,
  createViewportWorkspace,
  finalizeWorkspaceOwnership,
  restoreViewportWorkspace,
  type ViewportMoveIntent,
} from './viewport-workspace';

// Worker services are injected lazily; module construction never starts a scan.
export function createRunnerCapture(
  services: Pick<
    RunnerOperations,
    | 'pointerKey'
    | 'offscreen'
    | 'sleep'
    | 'guard'
    | 'errorText'
    | 'now'
    | 'content'
    | 'workspaceIntentKey'
    | 'workspaceKey'
    | 'guardedWait'
    | 'timed'
  > & { capture: CaptureOwner; workspace: WorkspaceOwner },
) {
  async function releasePointerOwner(
    id: string,
    session: PointerSession,
  ): Promise<void> {
    await releaseOwnedPointerSession({
      session,
      current: () => services.workspace.pointerSessions.get(id),
      intentional: services.workspace.intentionalPointerDetaches,
      forget: async () => {
        const stored = (
          await chrome.storage.session.get(services.pointerKey(session.tabId))
        )[services.pointerKey(session.tabId)] as
          StoredPointerSession | undefined;
        if (stored?.jobId === id && stored.generation === session.generation)
          await chrome.storage.session.remove(
            services.pointerKey(session.tabId),
          );
        if (services.workspace.pointerSessions.get(id) === session)
          services.workspace.pointerSessions.delete(id);
      },
    });
  }
  async function releaseCaptureSource(id: string, generation: string) {
    const source = services.capture.captureSources.get(id);
    if (!source || source.generation !== generation) return;
    source.active = false;
    await services.offscreen('CAPTURE_STOP', {
      generation,
      sourceId: source.sourceId,
    });
    const job = await getJob(id);
    if (!job || job.generation !== generation) return;
    await waitForCaptureRelease({
      guard: async () => {
        const current = services.capture.captureSources.get(id);
        if (
          current &&
          (current.generation !== generation ||
            current.sourceId !== source.sourceId)
        )
          throw new Error('CAPTURE_SOURCE_CHANGED_DURING_RELEASE');
      },
      released: async () =>
        !(await chrome.tabCapture.getCapturedTabs()).some(
          (capture) =>
            capture.tabId === job.tabId &&
            ['active', 'pending'].includes(capture.status),
        ),
      wait: services.sleep,
    });
  }
  async function prepareCaptureSource(
    id: string,
    generation: string,
    viewport: CaptureViewport,
  ) {
    const previous = services.capture.captureSources.get(id);
    if (!previous || previous.generation !== generation)
      throw new Error('CAPTURE_SOURCE_LEASE_UNAVAILABLE');
    if (previous.active && sameViewport(previous.viewport, viewport))
      return previous.sourceId;
    const job = await services.guard(id, generation);
    const sourceId = crypto.randomUUID();
    services.capture.captureSources.set(id, {
      generation,
      sourceId,
      viewport: { ...viewport },
      active: false,
    });
    try {
      await reopenCaptureSource(
        viewport,
        {
          guard: () => services.guard(id, generation),
          stop: () =>
            services.offscreen('CAPTURE_STOP', {
              generation,
              sourceId: previous.sourceId,
            }),
          released: async () =>
            !(await chrome.tabCapture.getCapturedTabs()).some(
              (capture) =>
                capture.tabId === job.tabId &&
                ['active', 'pending'].includes(capture.status),
            ),
          token: () =>
            chrome.tabCapture.getMediaStreamId({ targetTabId: job.tabId }),
          start: (streamId, sourceId, expectedViewport) =>
            services.offscreen('CAPTURE_START', {
              generation,
              sourceId,
              streamId,
              expectedViewport,
            }),
          cancel: (sourceId) =>
            services.offscreen('CAPTURE_STOP', { generation, sourceId }),
          wait: services.sleep,
        },
        sourceId,
      );
    } catch (error) {
      const reason = services.errorText(error);
      if (
        [
          'RUNNER_CANCELLED',
          'BUDGET_REACHED',
          'ORIGIN_CHANGED',
          'PERMISSION_REVOKED',
        ].includes(reason)
      )
        throw error;
      throw new Error(`CAPTURE_SOURCE_REOPEN_FAILED: ${reason}`, {
        cause: error,
      });
    }
    services.capture.captureSources.set(id, {
      generation,
      sourceId,
      viewport: { ...viewport },
      active: true,
    });
    return sourceId;
  }
  async function recordUnobserved(
    id: string,
    taskId: string,
    scenario: string,
    reason: string,
    coverage: 'SKIPPED' | 'UNREACHED' = 'SKIPPED',
  ) {
    await mutateJob(id, (job) => {
      const task = job.tasks.find((value) => value.id === taskId);
      if (!task) return;
      task.observations.push({
        id: crypto.randomUUID(),
        scenario,
        startedAt: services.now(),
        endedAt: services.now(),
        achieved: false,
        reason,
        coverage,
      });
      task.reasons.push(`${scenario}: ${reason}`);
    });
  }
  async function resizeViewport(
    id: string,
    generation: string,
    expected: { width: number; height: number; dpr: number },
    method: ReplayScenario['viewportMethod'] = 'PHYSICAL',
  ): Promise<PageInventory> {
    const job = await services.guard(id, generation);
    if (method === 'CDP')
      throw new Error('CDP_VIEWPORT_NATIVE_MAPPING_UNSUPPORTED');
    // A live tab producer can pin the old CSS extent, even after changing the
    // physical window. Release it before reading the geometry we must restore.
    await releaseCaptureSource(id, generation);
    await waitForStableViewport({
      guard: () => services.guard(id, generation),
      read: async () =>
        (
          await services.content<DiagnosticContext>(
            id,
            generation,
            'FG_DIAGNOSTIC_CONTEXT',
            {},
            1500,
          )
        ).viewport,
      wait: services.sleep,
    });
    const beforeWorkspace = (
      await services.content<DiagnosticContext>(
        id,
        generation,
        'FG_DIAGNOSTIC_CONTEXT',
      )
    ).viewport;
    if (
      expected.width > beforeWorkspace.width ||
      expected.height > beforeWorkspace.height
    )
      throw new Error('VIEWPORT_WORKSPACE_PROFILE_EXCEEDS_COVER');
    if (!services.workspace.viewportWorkspaces.has(id)) {
      await createViewportWorkspace({
        tabId: job.tabId,
        guard: () => services.guard(id, generation),
        read: async () =>
          (
            await services.content<DiagnosticContext>(
              id,
              generation,
              'FG_DIAGNOSTIC_CONTEXT',
            )
          ).viewport,
        wait: services.sleep,
        rememberIntent: async (intent) => {
          await chrome.storage.session.set({
            [services.workspaceIntentKey(id)]: intent,
          });
        },
        remember: async (workspace) => {
          const baseline = services.workspace.pointerSessions.get(id)?.restore;
          if (
            baseline &&
            baseline.window.id === workspace.originalWindowId &&
            (['width', 'height', 'left', 'top'] as const).every(
              (key) => baseline.window[key] === workspace.originalWindow[key],
            )
          )
            workspace.detachedViewport = { ...baseline.viewport };
          services.workspace.viewportWorkspaces.set(id, workspace);
          await chrome.storage.session.set({
            [services.workspaceKey(id)]: workspace,
          });
          await chrome.storage.session.remove(services.workspaceIntentKey(id));
        },
      });
    }
    return resizeCapturedViewport({
      tabId: job.tabId,
      expected,
      guard: () => services.guard(id, generation),
      read: () =>
        services.content<PageInventory>(id, generation, 'FG_INVENTORY'),
      wait: (route) => services.guardedWait(id, generation, 500, route),
      remember: (window) => {
        if (
          !services.workspace.viewportWorkspaces.has(id) &&
          !services.workspace.restoreWindows.has(id)
        )
          services.workspace.restoreWindows.set(id, window);
      },
    });
  }
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
                if (session) await releasePointerOwner(id, session);
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
  return {
    releasePointerOwner,
    releaseCaptureSource,
    prepareCaptureSource,
    recordUnobserved,
    resizeViewport,
    restoreEmulation,
    restoreWorkspace,
    ensureTerminalDebuggerWorkspace,
    unresolvedWorkspaceIntent,
    recordUnownedWorkspace,
    restoreWindow,
  };
}
