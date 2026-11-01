import { type PageInventory, type ReplayScenario } from './model';

import type { RunnerOperations } from './runner-contracts';

import { type DiagnosticContext } from './source-diagnostics';

import {
  resizeCapturedViewport,
  waitForStableViewport,
} from './viewport-driver';

import type { CaptureServices } from './runner-capture-services';
import { createViewportWorkspace } from './viewport-workspace';
/** Prepare owned physical or emulated viewport geometry before observation. */
export function createCaptureViewport(
  services: CaptureServices,
  dependencies: Pick<RunnerOperations, 'releaseCaptureSource'>,
) {
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
    await dependencies.releaseCaptureSource(id, generation);
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
  return { resizeViewport };
}
