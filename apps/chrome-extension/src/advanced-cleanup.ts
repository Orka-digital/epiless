import { assertAdvancedCleanup } from './advanced-cleanup-guard';
import {
  ADVANCED_SCAN_OWNER_KEY,
  closeDisposableScan,
  matchingRecord,
  type DisposableScanOwner,
} from './disposable-scan';

import { getJob, mutateJob } from './store';

import { ViewportRestoreDeadline } from './viewport-driver';

import type {
  AdvancedDependencies,
  AdvancedServices,
} from './runner-advanced-services';
import { assertViewportWorkspace } from './viewport-workspace';
/** Serialize owned-tab cleanup and retain manual recovery on uncertain browser state. */
export function createAdvancedCleanup(
  services: AdvancedServices,
  dependencies: Pick<
    AdvancedDependencies,
    | 'closingAdvancedTabs'
    | 'loadAdvancedOwner'
    | 'assertOriginalSource'
    | 'persistAdvancedOwner'
  >,
) {
  const advancedClosures = new Map<string, Promise<boolean>>();

  function closeAdvancedOwner(owner: DisposableScanOwner): Promise<boolean> {
    const key = `${owner.nonce}:${owner.generation ?? 'prepared'}`;
    const existing = advancedClosures.get(key);
    if (existing) return existing;
    if (owner.scanTabId !== undefined)
      dependencies.closingAdvancedTabs.add(owner.scanTabId);
    const operation = performAdvancedClose(owner).finally(() => {
      advancedClosures.delete(key);
      if (owner.scanTabId !== undefined)
        dependencies.closingAdvancedTabs.delete(owner.scanTabId);
    });
    advancedClosures.set(key, operation);
    return operation;
  }

  async function performAdvancedClose(
    owner: DisposableScanOwner,
  ): Promise<boolean> {
    let originalOwner = owner;
    const job = owner.jobId ? await getJob(owner.jobId) : undefined;
    const budget = cleanupBudget(owner);
    if (budget <= 0 || owner.phase === 'MANUAL') {
      if (job)
        await mutateJob(job.id, (state) => {
          if (state.disposableSource?.nonce === owner.nonce)
            state.disposableSource.cleanupStatus = 'MANUAL';
        });
      return false;
    }
    const deadline = new ViewportRestoreDeadline(budget);
    const within = <T>(operation: () => Promise<T>) => deadline.run(operation);
    const live = () =>
      assertAdvancedCleanup(services, dependencies, owner, deadline);

    const workspace = owner.jobId
      ? services.workspace.viewportWorkspaces.get(owner.jobId)
      : undefined;
    try {
      if (
        !matchingRecord(
          await within(dependencies.loadAdvancedOwner),
          originalOwner,
        )
      )
        throw new Error('ADVANCED_OWNER_CHANGED');
      owner = {
        ...owner,
        phase: 'CLOSING',
        cleanupExpiresAt: owner.cleanupExpiresAt ?? deadline.expiresEpochMs,
      };
      await within(() => dependencies.persistAdvancedOwner(owner));
      originalOwner = owner;
      await within(live);
      if (
        !matchingRecord(
          await within(dependencies.loadAdvancedOwner),
          originalOwner,
        )
      )
        throw new Error('ADVANCED_OWNER_CHANGED');
      if (workspace) {
        const stored = await within(() =>
          chrome.storage.session.get(services.workspaceKey(owner.jobId!)),
        );
        if (
          !matchingRecord(
            stored[services.workspaceKey(owner.jobId!)],
            workspace,
          )
        )
          throw new Error('ADVANCED_WORKSPACE_OWNER_CHANGED');
        await within(() => assertViewportWorkspace(workspace));
      }
      owner = {
        ...owner,
        cleanupExpiresAt: owner.cleanupExpiresAt ?? deadline.expiresEpochMs,
        ...(workspace ? { cleanupWindowId: workspace.windowId } : {}),
      };
      await within(() => dependencies.persistAdvancedOwner(owner));
    } catch (error) {
      if (deadline.remaining() > 0) {
        try {
          if (
            matchingRecord(
              await within(dependencies.loadAdvancedOwner),
              originalOwner,
            )
          )
            await within(() =>
              dependencies.persistAdvancedOwner({
                ...originalOwner,
                phase: 'MANUAL',
                reason: services.errorText(error),
              }),
            );
        } catch {
          /* Do not replace a timed-out write or changed owner. */
        }
      }
      if (job)
        await mutateJob(job.id, (state) => {
          if (state.disposableSource)
            state.disposableSource.cleanupStatus = 'MANUAL';
        });
      return false;
    }
    const closed = await closeDisposableScan({
      owner,
      load: () => within(dependencies.loadAdvancedOwner),
      persist: (value) =>
        within(() => dependencies.persistAdvancedOwner(value)),
      guard: () => within(live),
      locate: (tabId) =>
        within(async () => {
          const tab = (await chrome.tabs.query({})).find(
            (value) => value.id === tabId,
          );
          return tab?.id === undefined
            ? undefined
            : { tabId: tab.id, windowId: tab.windowId };
        }),
      remove: (tabId) =>
        within(async () => {
          if (deadline.remaining() <= 0)
            throw new Error('ADVANCED_CLEANUP_DEADLINE');
          await chrome.tabs.remove(tabId);
        }),
    });
    if (closed) await forgetClosedOwner(owner);
    if (job)
      await mutateJob(job.id, (state) => {
        if (state.disposableSource?.nonce !== owner.nonce) return;
        state.disposableSource.closed = closed;
        state.disposableSource.cleanupStatus = closed ? 'CLOSED' : 'MANUAL';
        if (
          !closed &&
          !state.limitations.includes(
            'ADVANCED_SCAN_TAB_MANUAL_CLEANUP_REQUIRED',
          )
        )
          state.limitations.push('ADVANCED_SCAN_TAB_MANUAL_CLEANUP_REQUIRED');
      });
    return closed;
  }
  async function forgetClosedOwner(owner: DisposableScanOwner): Promise<void> {
    const current = await dependencies.loadAdvancedOwner();
    if (current?.nonce === owner.nonce)
      await chrome.storage.session.remove(ADVANCED_SCAN_OWNER_KEY);
    if (owner.jobId) {
      services.workspace.viewportWorkspaces.delete(owner.jobId);
      services.workspace.restoreWindows.delete(owner.jobId);
      services.workspace.emulatedViewports.delete(owner.jobId);
      await chrome.storage.session.remove([
        services.workspaceKey(owner.jobId),
        services.workspaceIntentKey(owner.jobId),
      ]);
    }
  }
  return { advancedClosures, closeAdvancedOwner, performAdvancedClose };
}

function cleanupBudget(owner: DisposableScanOwner): number {
  return Math.min(
    5000,
    owner.cleanupExpiresAt === undefined
      ? 5000
      : owner.cleanupExpiresAt - Date.now(),
  );
}
