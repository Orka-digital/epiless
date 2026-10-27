import { planRoute } from '@epi-less/core';
import type { StartOptions } from './command-protocol';
import {
  ADVANCED_SCAN_OWNER_KEY,
  closeDisposableScan,
  createDisposableScan,
  matchingRecord,
  validOwnedStart,
  type DisposableScanOwner,
} from './disposable-scan';
import { viewportDuration, type ScanJob } from './model';
import type { RunnerOperations } from './runner-contracts';
import type { ExecutionOwner, WorkspaceOwner } from './runner-runtime';
import { type DiagnosticContext } from './source-diagnostics';
import {
  getJob,
  getPendingRecheck,
  mutateJob,
  setPendingRecheck,
} from './store';
import { ViewportRestoreDeadline } from './viewport-driver';
import { assertViewportWorkspace } from './viewport-workspace';

// Worker services are injected lazily; module construction never starts a scan.
export function createRunnerAdvanced(
  services: Pick<
    RunnerOperations,
    | 'timed'
    | 'workspaceKey'
    | 'workspaceIntentKey'
    | 'errorText'
    | 'now'
    | 'offscreen'
  > & { execution: ExecutionOwner; workspace: WorkspaceOwner },
) {
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
  async function prepareAdvancedScan(
    message: StartOptions,
    route?: string,
    allowInactiveSource = false,
  ) {
    if (
      services.execution.preparingAdvanced ||
      services.execution.running ||
      services.execution.authorizing
    )
      throw new Error(
        'Rond de bestaande geavanceerde voorbereiding of scan eerst af.',
      );
    const releasePreparation = services.execution.beginPreparation();
    try {
      if (await loadAdvancedOwner())
        throw new Error(
          'Rond de bestaande geavanceerde voorbereiding of scan eerst af.',
        );
      if (!chrome.runtime.getManifest().permissions?.includes('debugger'))
        throw new Error(
          'Deze extensie ondersteunt geen geavanceerde pointermeting.',
        );
      const source = await chrome.tabs.get(message.tabId);
      if (
        source.id === undefined ||
        !source.url ||
        !/^https?:/.test(source.url) ||
        source.pinned ||
        source.groupId !== -1
      )
        throw new Error('Open een gewone, niet-vastgemaakte website-tab.');
      const url = new URL(source.url);
      const destination = route ?? source.url;
      const decision = planRoute({
        candidate: destination,
        baseUrl: source.url,
        origin: url.origin,
        depth: 0,
      });
      if (
        !decision.allowed ||
        !decision.url ||
        new URL(destination).origin !== url.origin
      )
        throw new Error(
          'De geavanceerde scan vereist een veilige pagina op dezelfde oorsprong.',
        );
      if (
        !(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))
      )
        throw new Error('Sitetoestemming ontbreekt.');
      const window = await chrome.windows.get(source.windowId);
      const foreground = (
        await chrome.tabs.query({ active: true, windowId: source.windowId })
      )[0];
      if (
        !window.focused ||
        !foreground?.id ||
        (!allowInactiveSource && foreground.id !== source.id) ||
        window.width === undefined ||
        window.height === undefined ||
        window.left === undefined ||
        window.top === undefined
      )
        throw new Error('Activeer eerst het oorspronkelijke websitevenster.');
      await chrome.scripting.executeScript({
        target: { tabId: source.id },
        files: ['content.js'],
      });
      const context = await readOriginalContext(source.id);
      const mode =
        message.mode === 'QUICK'
          ? 'QUICK'
          : message.mode === 'EXTENDED'
            ? 'EXTENDED'
            : 'AUTONOMOUS';
      const owner: DisposableScanOwner = {
        version: 1,
        nonce: crypto.randomUUID(),
        phase: 'CREATE_INTENT',
        createdAt: Date.now(),
        source: {
          tabId: source.id,
          windowId: source.windowId,
          index: source.index,
          url: source.url,
          context,
          window: {
            width: window.width,
            height: window.height,
            left: window.left,
            top: window.top,
          },
        },
        foreground: { tabId: foreground.id, windowId: source.windowId },
        route: destination,
        mode,
        viewportSeconds: viewportDuration(mode, message.viewportSeconds) / 1000,
        ...(message.replayOf ? { replayOf: message.replayOf } : {}),
      };
      const prepared = await createDisposableScan({
        owner,
        load: loadAdvancedOwner,
        persist: persistAdvancedOwner,
        create: async () => {
          await assertOriginalSource(owner);
          const currentForeground = (
            await chrome.tabs.query({ active: true, windowId: source.windowId })
          )[0];
          if (
            !(await chrome.windows.get(source.windowId)).focused ||
            currentForeground?.id !== foreground.id
          )
            throw new Error('ADVANCED_PREPARE_FOREGROUND_CHANGED');
          const tab = await chrome.tabs.create({
            windowId: source.windowId,
            index: source.index + 1,
            openerTabId: source.id,
            url: destination,
            active: true,
          });
          if (tab.id === undefined)
            throw new Error('ADVANCED_CREATE_RECEIPT_MISSING');
          return { tabId: tab.id, windowId: tab.windowId };
        },
      });
      if (prepared.phase !== 'PREPARED' || prepared.scanTabId === undefined)
        throw new Error(
          prepared.reason ?? 'ADVANCED_PREPARATION_REQUIRES_MANUAL_REVIEW',
        );
      await chrome.action.setBadgeText({
        tabId: prepared.scanTabId,
        text: 'START',
      });
      return { tabId: prepared.scanTabId };
    } finally {
      releasePreparation();
    }
  }
  async function validateAdvancedStart(
    message: StartOptions,
    resume = false,
  ): Promise<DisposableScanOwner> {
    const owner = await loadAdvancedOwner();
    const tab = await chrome.tabs.get(message.tabId);
    if (
      !validOwnedStart(owner, {
        tabId: message.tabId,
        url: tab.url ?? '',
        mode: message.mode ?? 'AUTONOMOUS',
        viewportSeconds:
          viewportDuration(
            message.mode ?? 'AUTONOMOUS',
            message.viewportSeconds,
          ) / 1000,
        replayOf: message.replayOf,
      }) ||
      owner!.phase !== (resume ? 'PAUSED' : 'PREPARED')
    )
      throw new Error(
        'Bereid eerst een apart geavanceerd scantabblad voor en start daar via de toolbar.',
      );
    await assertOriginalSource(owner!);
    const window = await chrome.windows.get(tab.windowId);
    if (
      !tab.active ||
      tab.pinned ||
      tab.groupId !== -1 ||
      tab.windowId !== owner!.scanWindowId ||
      !window.focused
    )
      throw new Error(
        'Activeer het voorbereide scantabblad en start via de toolbar.',
      );
    return owner!;
  }
  const advancedClosures = new Map<string, Promise<boolean>>();
  function closeAdvancedOwner(owner: DisposableScanOwner): Promise<boolean> {
    const key = `${owner.nonce}:${owner.generation ?? 'prepared'}`;
    const existing = advancedClosures.get(key);
    if (existing) return existing;
    if (owner.scanTabId !== undefined) closingAdvancedTabs.add(owner.scanTabId);
    const operation = performAdvancedClose(owner).finally(() => {
      advancedClosures.delete(key);
      if (owner.scanTabId !== undefined)
        closingAdvancedTabs.delete(owner.scanTabId);
    });
    advancedClosures.set(key, operation);
    return operation;
  }
  async function performAdvancedClose(
    owner: DisposableScanOwner,
  ): Promise<boolean> {
    let originalOwner = owner;
    const job = owner.jobId ? await getJob(owner.jobId) : undefined;
    const budget = Math.min(
      5000,
      owner.cleanupExpiresAt === undefined
        ? 5000
        : owner.cleanupExpiresAt - Date.now(),
    );
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
    const live = async () => {
      if (deadline.remaining() <= 0)
        throw new Error('ADVANCED_CLEANUP_DEADLINE');
      const stored = await loadAdvancedOwner();
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
      const { window } = await assertOriginalSource(owner);
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
      if (deadline.remaining() <= 0)
        throw new Error('ADVANCED_CLEANUP_DEADLINE');
    };
    const workspace = owner.jobId
      ? services.workspace.viewportWorkspaces.get(owner.jobId)
      : undefined;
    try {
      if (!matchingRecord(await within(loadAdvancedOwner), originalOwner))
        throw new Error('ADVANCED_OWNER_CHANGED');
      owner = {
        ...owner,
        phase: 'CLOSING',
        cleanupExpiresAt: owner.cleanupExpiresAt ?? deadline.expiresEpochMs,
      };
      await within(() => persistAdvancedOwner(owner));
      originalOwner = owner;
      await within(live);
      if (!matchingRecord(await within(loadAdvancedOwner), originalOwner))
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
      await within(() => persistAdvancedOwner(owner));
    } catch (error) {
      if (deadline.remaining() > 0) {
        try {
          if (matchingRecord(await within(loadAdvancedOwner), originalOwner))
            await within(() =>
              persistAdvancedOwner({
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
      load: () => within(loadAdvancedOwner),
      persist: (value) => within(() => persistAdvancedOwner(value)),
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
    if (closed) {
      const current = await loadAdvancedOwner();
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
  async function showAdvancedDashboard(job: ScanJob) {
    const owner = await loadAdvancedOwner();
    try {
      if (
        !owner ||
        owner.nonce !== job.disposableSource?.nonce ||
        owner.jobId !== job.id ||
        owner.generation !== job.generation
      )
        throw new Error('ADVANCED_DASHBOARD_OWNER_CHANGED');
      await assertOriginalSource(owner);
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
        !matchingRecord(await loadAdvancedOwner(), owner) ||
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
        !matchingRecord(await loadAdvancedOwner(), owner)
      )
        throw new Error('ADVANCED_DASHBOARD_OWNER_CHANGED');
      await persistAdvancedOwner({ ...owner, dashboardTabId: dashboard.id });
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
    const owner = await loadAdvancedOwner();
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
      await persistAdvancedOwner({ ...owner, route: tab.url, phase: 'PAUSED' });
      return;
    }
    await closeAdvancedOwner(owner);
  }
  return {
    loadAdvancedOwner,
    persistAdvancedOwner,
    closingAdvancedTabs,
    readOriginalContext,
    assertOriginalSource,
    reconcileMissingAdvancedTab,
    prepareAdvancedScan,
    validateAdvancedStart,
    advancedClosures,
    closeAdvancedOwner,
    performAdvancedClose,
    showAdvancedDashboard,
    finalizeAdvancedJob,
  };
}
