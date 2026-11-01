import type { PageInventory } from './model';

import {
  ViewportRestoreDeadline,
  waitForStableViewport,
} from './viewport-driver';
import { assertViewportWorkspace } from './viewport-workspace-assert';
import {
  type ViewportWorkspace,
  type WorkspaceDriver,
  browser,
} from './viewport-workspace-driver';

/** Restore while the tab is still active in its unfocused workspace, then move
 * it back as an inactive tab. Never activate it in the foreground to fix layout. */
export async function restoreViewportWorkspace(options: {
  workspace: ViewportWorkspace;
  read(): Promise<PageInventory['viewport']>;
  wait(ms: number): Promise<void>;
  driver?: WorkspaceDriver;
  /** Release the job-owned debugger while the tab can still recompute layout.
   * Normal between-route restoration deliberately leaves this absent. */
  releaseDebugger?(): Promise<void>;
  /** Restart recovery keeps the original transaction's remaining budget. */
  deadline?: ViewportRestoreDeadline;
}): Promise<void> {
  const driver = options.driver ?? browser;
  const workspace = options.workspace;
  let deadline =
    options.deadline ??
    (options.releaseDebugger ? new ViewportRestoreDeadline() : undefined);
  const within = <T>(action: () => Promise<T>): Promise<T> =>
    deadline ? deadline.run(action) : action();
  const tab = await within(() => driver.tab(workspace.tabId));
  if (tab.windowId !== workspace.windowId)
    throw new Error('VIEWPORT_WORKSPACE_TAB_MOVED');
  const liveWorkspace = await within(() => driver.window(workspace.windowId));
  if (liveWorkspace.focused)
    throw new Error('VIEWPORT_WORKSPACE_BECAME_USER_WINDOW');
  const original = await within(() =>
    driver.window(workspace.originalWindowId),
  );
  const foreground = (
    await within(() => driver.tabs(workspace.originalWindowId))
  ).find((item) => item.active);
  if (!foreground || foreground.id === workspace.tabId)
    throw new Error('VIEWPORT_WORKSPACE_RETURN_TARGET_UNAVAILABLE');
  let failure: unknown;
  let terminalDebuggerReleased = false;
  let expected: PageInventory['viewport'] | undefined =
    workspace.originalViewport;
  try {
    // Do not resize a workspace that the user has brought to the foreground.
    await within(() => assertViewportWorkspace(workspace, driver));
    if (options.releaseDebugger) {
      try {
        await within(options.releaseDebugger);
        terminalDebuggerReleased = true;
        deadline ??= new ViewportRestoreDeadline();
        expected = workspace.detachedViewport;
        if (!expected)
          failure = new Error('VIEWPORT_PRE_DEBUGGER_GEOMETRY_UNAVAILABLE');
      } catch (error) {
        // Still return the user's tab and restore owned outer geometry when
        // safe. A failed release must remain an error, never a successful gate.
        failure = error;
      }
      // A detach event can run user callbacks. Recheck ownership/cover before
      // any resize or move; never activate the page in the foreground.
      await within(() => assertViewportWorkspace(workspace, driver));
    }
    await within(() =>
      driver.resize(workspace.windowId, workspace.originalWindow),
    );
    await waitForStableViewport({
      read: options.read,
      wait: options.wait,
      guard: () => assertViewportWorkspace(workspace, driver),
      expected,
      // Chromium156 retains the debugger notice for5s after the last detach.
      // Keep the already-owned tab active behind its cover until actual layout
      // settles. Capture has ended; elapsed time never substitutes for geometry.
      ...(terminalDebuggerReleased && expected
        ? {
            timeoutMs: 7000,
          }
        : {}),
      deadline,
    });
  } catch (error) {
    failure ??= error;
  }
  await returnWorkspaceTab(workspace, driver, within, original.id);
  if (failure) throw failure;
  await waitForStableViewport({
    read: options.read,
    wait: options.wait,
    expected,
    deadline,
  });
}

async function returnWorkspaceTab(
  workspace: ViewportWorkspace,
  driver: WorkspaceDriver,
  within: <T>(action: () => Promise<T>) => Promise<T>,
  originalId: number | undefined,
): Promise<void> {
  // Original user-owned window dimensions are never overwritten during cleanup.
  const current = await within(() => driver.tab(workspace.tabId));
  if (current.windowId !== workspace.windowId)
    throw new Error('VIEWPORT_WORKSPACE_TAB_MOVED');
  if (originalId === undefined)
    throw new Error('VIEWPORT_WORKSPACE_RETURN_TARGET_UNAVAILABLE');
  if ((await within(() => driver.window(workspace.windowId))).focused)
    throw new Error('VIEWPORT_WORKSPACE_BECAME_USER_WINDOW');
  await within(() =>
    driver.move(
      workspace.tabId,
      workspace.originalWindowId,
      workspace.originalIndex,
    ),
  );
  // Chrome closes the now-empty window automatically. Never remove a window:
  // an empty-query followed by windows.remove could race a newly added user tab.
  const returned = await within(() => driver.tab(workspace.tabId));
  if (returned.windowId !== workspace.originalWindowId || returned.active)
    throw new Error('VIEWPORT_WORKSPACE_RETURN_NOT_CONFIRMED');
}
