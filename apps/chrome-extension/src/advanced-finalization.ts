import { matchingRecord } from './disposable-scan';

import { type ScanJob } from './model';

import { getJob, mutateJob } from './store';

import type {
  AdvancedDependencies,
  AdvancedServices,
} from './runner-advanced-services';
/** Transfer focus only under matching ownership and finalize completed or paused scans. */
export function createAdvancedFinalization(
  services: AdvancedServices,
  dependencies: Pick<
    AdvancedDependencies,
    | 'loadAdvancedOwner'
    | 'assertOriginalSource'
    | 'persistAdvancedOwner'
    | 'closeAdvancedOwner'
  >,
) {
  async function showAdvancedDashboard(job: ScanJob) {
    const owner = await dependencies.loadAdvancedOwner();
    try {
      if (
        !owner ||
        owner.nonce !== job.disposableSource?.nonce ||
        owner.jobId !== job.id ||
        owner.generation !== job.generation
      )
        throw new Error('ADVANCED_DASHBOARD_OWNER_CHANGED');
      await dependencies.assertOriginalSource(owner);
      const tab = await chrome.tabs.get(job.tabId);
      const window = await chrome.windows.get(owner.source.windowId);
      if (
        !tab.active ||
        tab.windowId !== owner.source.windowId ||
        !window.focused
      )
        throw new Error('ADVANCED_DASHBOARD_FOREGROUND_CHANGED');
      const url = chrome.runtime.getURL(`dashboard.html#${job.id}`);
      const previous =
        owner.dashboardTabId === undefined
          ? undefined
          : (await chrome.tabs.query({})).find(
              (value) =>
                value.id === owner.dashboardTabId &&
                value.windowId === owner.source.windowId &&
                value.url === url,
            );
      if (
        !matchingRecord(await dependencies.loadAdvancedOwner(), owner) ||
        !(await chrome.windows.get(owner.source.windowId)).focused ||
        !(await chrome.tabs.get(job.tabId)).active
      )
        throw new Error('ADVANCED_DASHBOARD_FOREGROUND_CHANGED');
      const dashboard =
        previous?.id === undefined
          ? await chrome.tabs.create({
              windowId: owner.source.windowId,
              url,
              active: true,
            })
          : await chrome.tabs.update(previous.id, { active: true });
      if (
        dashboard?.id === undefined ||
        !matchingRecord(await dependencies.loadAdvancedOwner(), owner)
      )
        throw new Error('ADVANCED_DASHBOARD_OWNER_CHANGED');
      await dependencies.persistAdvancedOwner({
        ...owner,
        dashboardTabId: dashboard.id,
      });
    } catch (error) {
      await mutateJob(job.id, (state) => {
        if (state.generation !== job.generation) return;
        state.stopIntent = true;
        state.state = 'INTERRUPTED';
        state.stopReason = services.errorText(error);
        state.endedAt = services.now();
      });
      await services
        .offscreen('CAPTURE_STOP', { generation: job.generation })
        .catch(() => undefined);
      throw error;
    }
  }

  async function finalizeAdvancedJob(id: string, generation: string) {
    const job = await getJob(id);
    const owner = await dependencies.loadAdvancedOwner();
    if (
      !job?.disposableSource ||
      job.generation !== generation ||
      job.disposableSource.closed
    )
      return;
    if (
      !owner ||
      owner.nonce !== job.disposableSource.nonce ||
      owner.jobId !== id ||
      owner.generation !== generation
    ) {
      await mutateJob(id, (state) => {
        if (
          !state.disposableSource ||
          state.disposableSource.closed ||
          state.generation !== generation
        )
          return;
        state.disposableSource.cleanupStatus = 'MANUAL';
        if (!state.limitations.includes('ADVANCED_SCAN_OWNERSHIP_UNAVAILABLE'))
          state.limitations.push('ADVANCED_SCAN_OWNERSHIP_UNAVAILABLE');
      });
      return;
    }
    if (job.state === 'PAUSED') {
      const tab = await chrome.tabs.get(job.tabId);
      if (!tab.url || new URL(tab.url).origin !== job.origin)
        throw new Error('ADVANCED_PAUSE_ROUTE_CHANGED');
      await dependencies.persistAdvancedOwner({
        ...owner,
        route: tab.url,
        phase: 'PAUSED',
      });
      return;
    }
    await dependencies.closeAdvancedOwner(owner);
  }
  return { showAdvancedDashboard, finalizeAdvancedJob };
}
