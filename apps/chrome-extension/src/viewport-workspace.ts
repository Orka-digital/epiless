import type { PageInventory } from './model';

import { waitForStableViewport } from './viewport-driver';

import { assertViewportWorkspace } from './viewport-workspace-assert';
import {
  browser,
  type DebuggerViewportBaseline,
  type ViewportMoveIntent,
  type ViewportWorkspace,
  type WorkspaceDriver,
} from './viewport-workspace-driver';

/** An active tab in an unfocused window gets a real layout without exposing it
 * in the user's focused window. The source producer must already be stopped. */
export async function createViewportWorkspace(options: {
  tabId: number;
  guard(): Promise<unknown>;
  read(): Promise<PageInventory['viewport']>;
  wait(ms: number): Promise<void>;
  rememberIntent(intent: ViewportMoveIntent): Promise<void>;
  remember(workspace: ViewportWorkspace): Promise<void>;
  driver?: WorkspaceDriver;
}): Promise<ViewportWorkspace> {
  const driver = options.driver ?? browser;
  await options.guard();
  const tab = await driver.tab(options.tabId);
  const original = await driver.window(tab.windowId);
  // Moving grouped/pinned tabs would change their user-owned organization.
  if (tab.active || tab.pinned || tab.groupId >= 0)
    throw new Error('VIEWPORT_WORKSPACE_REQUIRES_UNGROUPED_BACKGROUND_TAB');
  if (
    original.type !== 'normal' ||
    original.state !== 'normal' ||
    !original.focused ||
    !original.width ||
    !original.height ||
    original.left === undefined ||
    original.top === undefined
  )
    throw new Error('VIEWPORT_WORKSPACE_REQUIRES_NORMAL_FOREGROUND_WINDOW');
  const viewport = await options.read();
  const geometry = {
    width: original.width,
    height: original.height,
    left: original.left,
    top: original.top,
  };
  await options.guard();
  const assertOriginalContext = async () => {
    const currentTab = await driver.tab(options.tabId);
    const currentOriginal = await driver.window(tab.windowId);
    if (
      currentTab.windowId !== tab.windowId ||
      currentTab.index !== tab.index ||
      currentTab.active ||
      currentTab.pinned ||
      currentTab.groupId >= 0 ||
      !currentOriginal.focused ||
      ['width', 'height', 'left', 'top'].some(
        (key) =>
          currentOriginal[key as keyof chrome.windows.Window] !==
          original[key as keyof chrome.windows.Window],
      )
    )
      throw new Error('VIEWPORT_WORKSPACE_CONTEXT_CHANGED');
  };
  await assertOriginalContext();
  // A prior intent preserves the original location if the worker dies between
  // browser creation and recording the returned owned-window ID. Such an intent
  // never grants guessed cleanup ownership: recovery asks for manual placement.
  await options.rememberIntent({
    tabId: options.tabId,
    originalWindowId: tab.windowId,
    originalIndex: tab.index,
  });
  await options.guard();
  await assertOriginalContext();
  const window = await driver.create(options.tabId, geometry);
  if (window.id === undefined)
    throw new Error('VIEWPORT_WORKSPACE_WINDOW_UNAVAILABLE');
  const workspace: ViewportWorkspace = {
    tabId: options.tabId,
    windowId: window.id,
    originalWindowId: tab.windowId,
    originalIndex: tab.index,
    originalViewport: { ...viewport },
    originalWindow: geometry,
  };
  // The caller records ownership before any cancellation/read can throw.
  await options.remember(workspace);
  await options.guard();
  await assertViewportWorkspace(workspace, driver);
  await waitForStableViewport({
    read: options.read,
    wait: options.wait,
    guard: options.guard,
    expected: viewport,
  });
  return workspace;
}

/** A stop can arrive just after between-route return. Recreate only an owned,
 * covered workspace so debugger removal can reflow the still-active renderer.
 * The caller must have confirmed producer release and retain debugger ownership. */
export async function createDebuggerRestoreWorkspace(
  options: Parameters<typeof createViewportWorkspace>[0] & {
    baseline: DebuggerViewportBaseline;
  },
): Promise<ViewportWorkspace> {
  const driver = options.driver ?? browser;
  const baseline = options.baseline;
  const tab = await driver.tab(options.tabId);
  if (tab.windowId !== baseline.window.id)
    throw new Error('DEBUGGER_RESTORE_WINDOW_CHANGED');
  return createViewportWorkspace({
    ...options,
    guard: async () => {
      await options.guard();
      const window = await driver.window(baseline.window.id);
      if (
        (['width', 'height', 'left', 'top'] as const).some(
          (key) => window[key] !== baseline.window[key],
        )
      )
        throw new Error('DEBUGGER_RESTORE_WINDOW_CHANGED');
    },
    remember: async (workspace) => {
      workspace.detachedViewport = { ...baseline.viewport };
      await options.remember(workspace);
    },
  });
}

export {
  finalizeWorkspaceOwnership,
  sameWorkspaceOwnership,
} from './viewport-workspace-driver';

export type {
  DebuggerViewportBaseline,
  ViewportMoveIntent,
  ViewportWorkspace,
  WorkspaceDriver,
} from './viewport-workspace-driver';

export { assertViewportWorkspace } from './viewport-workspace-assert';
export { restoreViewportWorkspace } from './viewport-workspace-restore';
