/** read Original Snapshot using actual browser state and retained fixture ownership. */
export async function readOriginalSnapshot({ config, evidence, initial }) {
  const page = await (await fetch(config.origin + '/original-page')).json();
  if (!page.tab || !page.geometry) return null;
  const tabId = evidence.ownedScan.originalInitial?.tab.id ?? page.tab.tabId;
  if (tabId !== page.tab.tabId)
    throw new Error('Original fixture identity changed');
  const tab = await chrome.tabs.get(tabId);
  const window = await chrome.windows.get(tab.windowId);
  let document = page.geometry;
  if (!initial) {
    // Read-only fixture identity, after the real UI has granted host access.
    // This never injects scanner code, changes the page or authorizes a scan.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => ({
        at: Date.now(),
        documentId: globalThis.__nativeContextDocumentId,
        url: location.href,
        timeOrigin: performance.timeOrigin,
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
        outerWidth,
        outerHeight,
      }),
    });
    document = results[0]?.result;
    if (!document?.documentId)
      throw new Error('Original page document evidence unavailable');
  }
  const contextReply = await chrome.tabs
    .sendMessage(tabId, {
      type: 'FG_DIAGNOSTIC_CONTEXT',
    })
    .catch(() => null);
  return {
    at: Date.now(),
    tab: {
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      active: tab.active,
      url: tab.url,
      pinned: tab.pinned,
      groupId: tab.groupId,
    },
    window: {
      id: window.id,
      width: window.width,
      height: window.height,
      left: window.left,
      top: window.top,
      focused: window.focused,
    },
    foregroundTabId: (
      await chrome.tabs.query({ active: true, windowId: window.id })
    )[0]?.id,
    zoom: await chrome.tabs.getZoom(tabId),
    document,
    context: contextReply?.ok ? contextReply.value : null,
  };
}
