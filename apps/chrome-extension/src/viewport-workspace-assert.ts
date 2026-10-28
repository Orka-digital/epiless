import { browser, type ViewportWorkspace } from './viewport-workspace-driver';

/** Reject changed workspace ownership before viewport mutation. */
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
