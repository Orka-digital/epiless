import {
  ADVANCED_SCAN_OWNER_KEY,
  matchingRecord,
  type DisposableScanOwner,
} from './disposable-scan';

import { type DiagnosticContext } from './source-diagnostics';

import { getPendingRecheck, mutateJob, setPendingRecheck } from './store';

import type { AdvancedServices } from './runner-advanced-services';
/** Read and reconcile persisted advanced-scan ownership without manufacturing a replacement tab. */
export function createAdvancedOwnership(services: AdvancedServices) {
  const loadAdvancedOwner = async (): Promise<
    DisposableScanOwner | undefined
  > =>
    (await chrome.storage.session.get(ADVANCED_SCAN_OWNER_KEY))[
      ADVANCED_SCAN_OWNER_KEY
    ] as DisposableScanOwner | undefined;

  const persistAdvancedOwner = (owner: DisposableScanOwner) =>
    chrome.storage.session.set({ [ADVANCED_SCAN_OWNER_KEY]: owner });

  const closingAdvancedTabs = new Set<number>();

  async function readOriginalContext(
    tabId: number,
  ): Promise<DiagnosticContext> {
    const reply = await services.timed(
      chrome.tabs.sendMessage(tabId, { type: 'FG_DIAGNOSTIC_CONTEXT' }),
      1500,
    );
    if (!reply?.ok || !reply.value?.documentToken || !reply.value?.url)
      throw new Error('ADVANCED_ORIGINAL_CONTEXT_UNAVAILABLE');
    return reply.value;
  }

  async function assertOriginalSource(owner: DisposableScanOwner) {
    const [tab, window, context] = await Promise.all([
      chrome.tabs.get(owner.source.tabId),
      chrome.windows.get(owner.source.windowId),
      readOriginalContext(owner.source.tabId),
    ]);
    if (
      tab.windowId !== owner.source.windowId ||
      tab.index !== owner.source.index ||
      tab.url !== owner.source.url ||
      context.url !== owner.source.context.url ||
      context.documentToken !== owner.source.context.documentToken ||
      !matchingRecord(context.viewport, owner.source.context.viewport) ||
      (['width', 'height', 'left', 'top'] as const).some(
        (key) => window[key] !== owner.source.window[key],
      )
    )
      throw new Error('ADVANCED_ORIGINAL_CONTEXT_CHANGED');
    return { tab, window };
  }

  async function reconcileMissingAdvancedTab() {
    const owner = await loadAdvancedOwner();
    if (
      owner?.scanTabId === undefined ||
      closingAdvancedTabs.has(owner.scanTabId)
    )
      return;
    const known = (await chrome.tabs.query({})).some(
      (tab) => tab.id === owner.scanTabId,
    );
    if (known || !matchingRecord(await loadAdvancedOwner(), owner)) return;
    await chrome.storage.session.remove(ADVANCED_SCAN_OWNER_KEY);
    const pending = await getPendingRecheck();
    if (
      pending &&
      pending.tabId === owner.scanTabId &&
      matchingRecord(pending.replayOf, owner.replayOf)
    )
      await setPendingRecheck(undefined);
    if (owner.jobId) {
      await chrome.storage.session.remove([
        services.workspaceKey(owner.jobId),
        services.workspaceIntentKey(owner.jobId),
      ]);
      services.workspace.viewportWorkspaces.delete(owner.jobId);
      await mutateJob(owner.jobId, (state) => {
        if (state.disposableSource?.nonce === owner.nonce) {
          state.disposableSource.closed = true;
          state.disposableSource.cleanupStatus = 'CLOSED';
        }
      });
    }
  }
  return {
    loadAdvancedOwner,
    persistAdvancedOwner,
    closingAdvancedTabs,
    readOriginalContext,
    assertOriginalSource,
    reconcileMissingAdvancedTab,
  };
}
