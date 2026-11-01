/** read Context Snapshot using actual browser state and retained fixture ownership. */
export async function readContextSnapshot({
  config,
  ownedSnapshot,
  job,
  evidence,
  tracks,
}) {
  if (config.ownedScan) return ownedSnapshot(job);
  const at = Date.now();
  const tab = await chrome.tabs.get(job.tabId);
  const window = await chrome.windows.get(tab.windowId);
  const session = await chrome.storage.session.get(null);
  const workspace = session[`viewport-workspace:${job.id}`];
  const originalWindowId =
    workspace?.originalWindowId ??
    evidence.cancellation?.before.workspace.originalWindowId ??
    tab.windowId;
  const originalWindow = await chrome.windows
    .get(originalWindowId)
    .catch(() => null);
  const contextReply = await chrome.tabs
    .sendMessage(job.tabId, { type: 'FG_DIAGNOSTIC_CONTEXT' })
    .catch(() => null);
  return {
    at,
    jobId: job.id,
    generation: job.generation,
    jobState: job.state,
    pendingAction: job.tasks.find((task) => task.state === 'RUNNING')
      ?.pendingAction,
    tab: {
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      active: tab.active,
    },
    window: {
      id: window.id,
      width: window.width,
      height: window.height,
      left: window.left,
      top: window.top,
      focused: window.focused,
    },
    originalWindow: originalWindow && {
      id: originalWindow.id,
      width: originalWindow.width,
      height: originalWindow.height,
      left: originalWindow.left,
      top: originalWindow.top,
      focused: originalWindow.focused,
    },
    foregroundTabId: (
      await chrome.tabs.query({ active: true, windowId: originalWindowId })
    )[0]?.id,
    zoom: await chrome.tabs.getZoom(job.tabId),
    context: contextReply?.ok ? contextReply.value : null,
    workspace: workspace ?? null,
    ...(config.tabSwitchProbe && workspace
      ? {
          workspaceTabs: (
            await chrome.tabs.query({ windowId: workspace.windowId })
          ).map(
            ({
              id,
              windowId,
              active,
              url,
              pendingUrl,
              pinned,
              groupId,
              openerTabId,
            }) => ({
              id,
              windowId,
              active,
              url,
              pendingUrl,
              pinned,
              groupId,
              openerTabId,
            }),
          ),
        }
      : {}),
    ownershipKeys: Object.keys(session).filter(
      (key) =>
        key === `viewport-workspace:${job.id}` ||
        key === `viewport-workspace-intent:${job.id}` ||
        key === `viewport-rebind:${job.id}` ||
        key === `pointer-session:${job.tabId}`,
    ),
    windowIds: (await chrome.windows.getAll()).map((value) => value.id),
    debuggerAttached:
      (await chrome.debugger.getTargets()).find(
        (value) => value.tabId === job.tabId,
      )?.attached ?? false,
    capturedTabs: (await chrome.tabCapture.getCapturedTabs()).map(
      ({ tabId, status, fullscreen }) => ({ tabId, status, fullscreen }),
    ),
    tracks: await tracks(),
  };
}
