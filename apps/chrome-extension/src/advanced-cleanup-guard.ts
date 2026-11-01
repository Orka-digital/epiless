import type { DisposableScanOwner } from './disposable-scan';
import type {
  AdvancedDependencies,
  AdvancedServices,
} from './runner-advanced-services';
import { getJob } from './store';
import { ViewportRestoreDeadline } from './viewport-driver';
import { assertViewportWorkspace } from './viewport-workspace';
type Dependencies = Pick<
  AdvancedDependencies,
  'loadAdvancedOwner' | 'assertOriginalSource'
>;
/** Revalidate ownership, capture release, foreground and tab placement before every cleanup step. */
export async function assertAdvancedCleanup(
  services: AdvancedServices,
  dependencies: Dependencies,
  owner: DisposableScanOwner,
  deadline: ViewportRestoreDeadline,
): Promise<void> {
  if (deadline.remaining() <= 0) throw new Error('ADVANCED_CLEANUP_DEADLINE');
  await assertCleanupOwnership(dependencies, owner);
  const [captures, targets] = await Promise.all([
    chrome.tabCapture.getCapturedTabs(),
    chrome.debugger.getTargets(),
  ]);
  if (
    captures.some(
      (value) =>
        value.tabId === owner.scanTabId &&
        ['active', 'pending'].includes(value.status),
    ) ||
    targets.some(
      (value) => value.tabId === owner.scanTabId && value.attached,
    ) ||
    (owner.jobId && services.workspace.pointerSessions.has(owner.jobId))
  )
    throw new Error('ADVANCED_SOURCE_RELEASE_UNCONFIRMED');
  const { window } = await dependencies.assertOriginalSource(owner);
  const tab = (await chrome.tabs.query({})).find(
    (value) => value.id === owner.scanTabId,
  );
  if (!tab) return;
  if (
    !window.focused ||
    tab.pinned ||
    tab.groupId !== -1 ||
    !tab.url ||
    new URL(tab.url).origin !== new URL(owner.route).origin
  )
    throw new Error('ADVANCED_CLEANUP_CONTEXT_CHANGED');
  const foreground = (
    await chrome.tabs.query({
      active: true,
      windowId: owner.source.windowId,
    })
  )[0];
  const allowedForeground =
    foreground?.id === owner.dashboardTabId ||
    foreground?.id === owner.scanTabId;
  if (!allowedForeground)
    throw new Error('ADVANCED_CLEANUP_FOREGROUND_CHANGED');
  await assertCleanupPlacement(services, owner, tab, foreground);
  if (deadline.remaining() <= 0) throw new Error('ADVANCED_CLEANUP_DEADLINE');
}
async function assertCleanupOwnership(
  dependencies: Dependencies,
  owner: DisposableScanOwner,
): Promise<void> {
  const stored = await dependencies.loadAdvancedOwner();
  if (
    !stored ||
    stored.nonce !== owner.nonce ||
    stored.scanTabId !== owner.scanTabId ||
    stored.jobId !== owner.jobId ||
    stored.generation !== owner.generation
  )
    throw new Error('ADVANCED_OWNER_CHANGED');
  const current = owner.jobId ? await getJob(owner.jobId) : undefined;
  if (
    owner.jobId &&
    (!current ||
      current.generation !== owner.generation ||
      current.disposableSource?.nonce !== owner.nonce)
  )
    throw new Error('ADVANCED_JOB_OWNER_CHANGED');
}
async function assertCleanupPlacement(
  services: AdvancedServices,
  owner: DisposableScanOwner,
  tab: chrome.tabs.Tab,
  foreground: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (tab.windowId === owner.scanWindowId) {
    if (tab.active && foreground?.id !== tab.id)
      throw new Error('ADVANCED_SCAN_TAB_CHANGED');
  } else {
    const workspace = owner.jobId
      ? services.workspace.viewportWorkspaces.get(owner.jobId)
      : undefined;
    if (
      !workspace ||
      workspace.tabId !== tab.id ||
      workspace.windowId !== tab.windowId
    )
      throw new Error('ADVANCED_SCAN_LOCATION_CHANGED');
    await assertViewportWorkspace(workspace);
  }
}
