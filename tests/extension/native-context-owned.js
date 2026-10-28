/** read Owned Snapshot using actual browser state and retained fixture ownership. */
export async function readOwnedSnapshot({ job, originalSnapshot, tracks }) {
  const at = Date.now();
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((value) => value.id === job.tabId);
  const window = tab ? await chrome.windows.get(tab.windowId) : null;
  const session = await chrome.storage.session.get(null);
  const original = await originalSnapshot();
  const contextReply = tab
    ? await chrome.tabs
        .sendMessage(job.tabId, {
          type: 'FG_DIAGNOSTIC_CONTEXT',
        })
        .catch(() => null)
    : null;
  const debuggerTabIds = (await chrome.debugger.getTargets())
    .filter((value) => value.attached)
    .map((value) => value.tabId);
  return {
    at,
    jobId: job.id,
    generation: job.generation,
    jobState: job.state,
    pendingAction: job.tasks.find((task) => task.state === 'RUNNING')
      ?.pendingAction,
    tab: tab
      ? {
          id: tab.id,
          windowId: tab.windowId,
          index: tab.index,
          active: tab.active,
          url: tab.url,
        }
      : null,
    window: window
      ? {
          id: window.id,
          width: window.width,
          height: window.height,
          left: window.left,
          top: window.top,
          focused: window.focused,
        }
      : null,
    tabIds: tabs.map((value) => value.id),
    original,
    originalWindow: original?.window ?? null,
    foregroundTabId: original?.foregroundTabId,
    context: contextReply?.ok ? contextReply.value : null,
    workspace: session[`viewport-workspace:${job.id}`] ?? null,
    ownedScanOwner: session['advanced-scan-owner'] ?? null,
    ownershipKeys: Object.keys(session).filter(
      (key) =>
        key === 'advanced-scan-owner' ||
        key === `viewport-workspace:${job.id}` ||
        key === `viewport-workspace-intent:${job.id}` ||
        key === `viewport-rebind:${job.id}` ||
        key === `pointer-session:${job.tabId}`,
    ),
    windowIds: (await chrome.windows.getAll()).map((value) => value.id),
    debuggerAttached: debuggerTabIds.includes(job.tabId),
    debuggerTabIds,
    capturedTabs: (await chrome.tabCapture.getCapturedTabs()).map(
      ({ tabId, status, fullscreen }) => ({ tabId, status, fullscreen }),
    ),
    tracks: await tracks(),
  };
}
