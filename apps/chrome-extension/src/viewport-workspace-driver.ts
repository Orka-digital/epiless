import type { PageInventory } from './model';

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

export const browser: WorkspaceDriver = {
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
