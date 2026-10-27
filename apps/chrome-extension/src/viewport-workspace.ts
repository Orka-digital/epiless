import type { PageInventory } from './model';
import {
  waitForStableViewport,
  ViewportRestoreDeadline,
} from './viewport-driver';

export interface ViewportWorkspace {
  tabId: number;
  windowId: number;
  originalWindowId: number;
  originalIndex: number;
  originalViewport: PageInventory['viewport'];
  /** Measured before this job attached its debugger, at these exact original
   * window bounds. Used only after confirmed terminal debugger release. */
  detachedViewport?: PageInventory['viewport'];
  originalWindow: { width: number; height: number; left: number; top: number };
}

/** Chrome storage roundtrips reorder object properties. Compare every retained
 * field/value, including additional diagnostic geometry, independently of key
 * order. This must not turn into a selected-ID or approximate-DPR comparison. */
export function sameWorkspaceOwnership(
  owner: ViewportWorkspace | undefined,
  workspace: ViewportWorkspace,
): boolean {
  const sameFields = (left: unknown, right: unknown): boolean => {
    if (typeof left !== typeof right) return false;
    if (typeof left === 'number')
      return Number.isFinite(left) && left === right;
    if (left === null || right === null || typeof left !== 'object')
      return left === right;
    if (Array.isArray(left) || Array.isArray(right)) return false;
    const first = left as Record<string, unknown>;
    const second = right as Record<string, unknown>;
    // JSON and Chrome storage omit undefined optional object fields.
    const keys = Object.keys(first)
      .filter((key) => first[key] !== undefined)
      .sort();
    const otherKeys = Object.keys(second)
      .filter((key) => second[key] !== undefined)
      .sort();
    return (
      keys.length === otherKeys.length &&
      keys.every(
        (key, index) =>
          key === otherKeys[index] && sameFields(first[key], second[key]),
      )
    );
  };
  return !!owner && sameFields(owner, workspace);
}
export interface ViewportMoveIntent {
  tabId: number;
  originalWindowId: number;
  originalIndex: number;
}
export interface DebuggerViewportBaseline {
  viewport: PageInventory['viewport'];
  window: ViewportWorkspace['originalWindow'] & { id: number };
}

/** Failed return revokes automatic window authority, but must retain enough
 * location data for manual recovery. A failed browser query is not a closed tab. */
export async function finalizeWorkspaceOwnership(options: {
  workspace: ViewportWorkspace;
  locate(): Promise<{ windowId: number } | undefined>;
  clear(): Promise<void>;
  downgrade(intent: ViewportMoveIntent): Promise<void>;
}): Promise<void> {
  let known = false;
  let tab: { windowId: number } | undefined;
  try {
    tab = await options.locate();
    known = true;
  } catch {
    /* Retain manual intent when location is unknown. */
  }
  if (known && (!tab || tab.windowId === options.workspace.originalWindowId)) {
    await options.clear();
    return;
  }
  await options.downgrade({
    tabId: options.workspace.tabId,
    originalWindowId: options.workspace.originalWindowId,
    originalIndex: options.workspace.originalIndex,
  });
}
export interface WorkspaceDriver {
  tab(
    id: number,
  ): Promise<
    Pick<
      chrome.tabs.Tab,
      'id' | 'windowId' | 'index' | 'active' | 'pinned' | 'groupId' | 'url'
    >
  >;
  window(id: number): Promise<chrome.windows.Window>;
  tabs(id: number): Promise<Array<Pick<chrome.tabs.Tab, 'id' | 'active'>>>;
  create(
    tabId: number,
    geometry: ViewportWorkspace['originalWindow'],
  ): Promise<chrome.windows.Window>;
  resize(
    id: number,
    geometry: ViewportWorkspace['originalWindow'],
  ): Promise<unknown>;
  move(tabId: number, windowId: number, index: number): Promise<unknown>;
}
const browser: WorkspaceDriver = {
  tab: (id) => chrome.tabs.get(id),
  window: (id) => chrome.windows.get(id),
  tabs: (windowId) => chrome.tabs.query({ windowId }),
  create: async (tabId, geometry) => {
    const window = await chrome.windows.create({
      tabId,
      ...geometry,
      type: 'normal',
      focused: false,
    });
    if (!window) throw new Error('VIEWPORT_WORKSPACE_WINDOW_UNAVAILABLE');
    return window;
  },
  resize: (id, geometry) => chrome.windows.update(id, geometry),
  move: (tabId, windowId, index) =>
    chrome.tabs.move(tabId, { windowId, index }),
};

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

export async function assertViewportWorkspace(
  workspace: ViewportWorkspace,
  driver = browser,
): Promise<void> {
  const tab = await driver.tab(workspace.tabId);
  const window = await driver.window(workspace.windowId);
  const original = await driver.window(workspace.originalWindowId);
  if (
    tab.windowId !== workspace.windowId ||
    !tab.active ||
    window.focused ||
    !original.focused
  )
    throw new Error('VIEWPORT_WORKSPACE_CONTEXT_CHANGED');
  if (
    original.width !== workspace.originalWindow.width ||
    original.height !== workspace.originalWindow.height ||
    original.left !== workspace.originalWindow.left ||
    original.top !== workspace.originalWindow.top
  )
    throw new Error('VIEWPORT_WORKSPACE_COVER_CHANGED');
  if (
    window.left === undefined ||
    window.top === undefined ||
    !window.width ||
    !window.height ||
    window.left < workspace.originalWindow.left ||
    window.top < workspace.originalWindow.top ||
    window.left + window.width >
      workspace.originalWindow.left + workspace.originalWindow.width ||
    window.top + window.height >
      workspace.originalWindow.top + workspace.originalWindow.height
  )
    throw new Error('VIEWPORT_WORKSPACE_OUTSIDE_COVER');
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
    try {
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
      throw error;
    }
  } catch (error) {
    failure ??= error;
  }
  // Original user-owned window dimensions are never overwritten during cleanup.
  const current = await within(() => driver.tab(workspace.tabId));
  if (current.windowId !== workspace.windowId)
    throw new Error('VIEWPORT_WORKSPACE_TAB_MOVED');
  if (original.id === undefined)
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
  if (failure) throw failure;
  await waitForStableViewport({
    read: options.read,
    wait: options.wait,
    expected,
    deadline,
  });
}
