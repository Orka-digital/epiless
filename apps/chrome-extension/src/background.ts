import type { StoredPointerSession } from './runner-types';
import { contentHash, normalizePublicUrl } from '@epi-less/core';
import { waitForCaptureRelease } from './capture-source';
import { TERMINAL_STATES } from './model';
import { createRunnerAdvanced } from './runner-advanced';
import { createRunnerAuthorization } from './runner-authorization';
import { createRunnerCapture } from './runner-capture';
import { createRunnerCommands } from './runner-commands';
import { createRunnerNavigation } from './runner-navigation';
import { createRunnerObservation } from './runner-observation';
import { createRunnerOffscreen } from './runner-offscreen';
import { trustedTransferSender } from './runner-policy';
import { CaptureOwner, ExecutionOwner, WorkspaceOwner } from './runner-runtime';
import { createRunnerScheduler } from './runner-scheduler';
import { applyRetention, consumeTransfer, listJobs, mutateJob } from './store';
import { detachPointerSession } from './trusted-pointer';
import { clearEmulatedViewport } from './viewport-driver';
import { type ViewportWorkspace } from './viewport-workspace';

declare const __WEB_ORIGIN__: string;
const execution = new ExecutionOwner();
const capture = new CaptureOwner();
const workspace = new WorkspaceOwner();

const sleep = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration));
const now = () => new Date().toISOString();
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const observedUrl = (value: string | undefined, fallback: string): string => {
  try {
    return normalizePublicUrl(value ?? fallback);
  } catch {
    return fallback;
  }
};

const pointerKey = (tabId: number) => `pointer-session:${tabId}`;

const workspaceKey = (id: string) => `viewport-workspace:${id}`;
const workspaceIntentKey = (id: string) => `viewport-workspace-intent:${id}`;

const {
  releasePointerOwner,
  releaseCaptureSource,
  prepareCaptureSource,
  recordUnobserved,
  resizeViewport,
  restoreEmulation,
  restoreWorkspace,
  ensureTerminalDebuggerWorkspace,
  unresolvedWorkspaceIntent,
  recordUnownedWorkspace,
  restoreWindow,
} = createRunnerCapture({
  workspace,
  capture,

  pointerKey,

  get offscreen() {
    return offscreen;
  },
  sleep,
  get guard() {
    return guard;
  },
  errorText,
  now,
  get content() {
    return content;
  },

  workspaceIntentKey,
  workspaceKey,
  get guardedWait() {
    return guardedWait;
  },

  get timed() {
    return timed;
  },
});

const { offscreen, ensureOffscreen, timed } = createRunnerOffscreen();

const {
  loadAdvancedOwner,
  persistAdvancedOwner,
  closingAdvancedTabs,
  reconcileMissingAdvancedTab,
  prepareAdvancedScan,
  validateAdvancedStart,
  closeAdvancedOwner,
  showAdvancedDashboard,
  finalizeAdvancedJob,
} = createRunnerAdvanced({
  workspace,
  execution,
  timed,
  workspaceKey,
  workspaceIntentKey,

  errorText,

  now,
  offscreen,
});

const { guard, guardedWait, content, loadRoute } = createRunnerNavigation({
  execution,
  workspace,

  sleep,
  timed,
});

const { observe, hoverControl, runReplay } = createRunnerObservation({
  capture,
  workspace,
  guard,
  now,
  content,
  observedUrl,

  recordUnobserved,
  prepareCaptureSource,

  guardedWait,
  offscreen,
  errorText,

  resizeViewport,
});

const { runJob } = createRunnerScheduler({
  workspace,
  capture,
  execution,
  guard,

  observe,
  loadRoute,
  guardedWait,
  content,
  recordUnobserved,
  runReplay,
  hoverControl,
  resizeViewport,
  errorText,

  releaseCaptureSource,
  restoreEmulation,
  restoreWindow,
  restoreWorkspace,
  recordUnownedWorkspace,
  offscreen,

  ensureTerminalDebuggerWorkspace,
  now,
  releasePointerOwner,
  finalizeAdvancedJob,
});

const { authorize } = createRunnerAuthorization({
  execution,
  workspace,
  capture,

  ensureOffscreen,
  sleep,

  pointerKey,

  offscreen,

  runJob,
  releasePointerOwner,
  errorText,
  now,
  finalizeAdvancedJob,
});

const { handle, continueStartIntent } = createRunnerCommands({
  capture,
  execution,
  get initialized() {
    return initialized;
  },
  reconcileMissingAdvancedTab,
  prepareAdvancedScan,
  loadAdvancedOwner,
  closeAdvancedOwner,

  content,

  unresolvedWorkspaceIntent,
  __WEB_ORIGIN__,
  validateAdvancedStart,
  now,
  persistAdvancedOwner,
  authorize,
  showAdvancedDashboard,
  offscreen,
  finalizeAdvancedJob,
});
const initialized = (async () => {
  await offscreen('CAPTURE_STOP').catch(() => undefined);
  await reconcileMissingAdvancedTab();
  for (const job of await listJobs()) {
    const pointer = (await chrome.storage.session.get(pointerKey(job.tabId)))[
      pointerKey(job.tabId)
    ] as StoredPointerSession | undefined;
    if (
      pointer?.jobId === job.id &&
      pointer.generation === job.generation &&
      pointer.tabId === job.tabId
    )
      workspace.pointerSessions.set(job.id, pointer);
    const stored = (await chrome.storage.session.get(workspaceKey(job.id)))[
      workspaceKey(job.id)
    ] as ViewportWorkspace | undefined;
    if (job.disposableSource) {
      if (job.disposableSource.closed) {
        const retainedPointer = workspace.pointerSessions.get(job.id);
        if (retainedPointer)
          await releasePointerOwner(job.id, retainedPointer).catch(
            async (error) => {
              await mutateJob(job.id, (state) => {
                state.limitations.push(
                  `DEBUGGER_RELEASE_UNCONFIRMED: ${errorText(error)}`,
                );
              });
            },
          );
        continue;
      }
      if (stored?.tabId === job.tabId)
        workspace.viewportWorkspaces.set(job.id, stored);
      try {
        await waitForCaptureRelease({
          guard: async () => undefined,
          released: async () =>
            !(await chrome.tabCapture.getCapturedTabs()).some(
              (value) =>
                value.tabId === job.tabId &&
                ['active', 'pending'].includes(value.status),
            ),
          wait: sleep,
        });
        if (job.state === 'PAUSED' && workspace.viewportWorkspaces.has(job.id))
          await restoreWorkspace(job.id);
        const ownedPointer = workspace.pointerSessions.get(job.id);
        if (ownedPointer) await releasePointerOwner(job.id, ownedPointer);
        if (!TERMINAL_STATES.includes(job.state) && job.state !== 'PAUSED')
          await mutateJob(job.id, (state) => {
            state.state = 'INTERRUPTED';
            state.stopIntent = true;
            state.endedAt = now();
            state.stopReason = 'BROWSER_OR_WORKER_RESTART';
            state.limitations.push(
              'RUNNER_INTERRUPTED: capture continuity cannot be recovered after a worker restart.',
            );
          });
        await finalizeAdvancedJob(job.id, job.generation);
      } catch (error) {
        const owner = await loadAdvancedOwner();
        if (owner?.nonce === job.disposableSource.nonce)
          await persistAdvancedOwner({
            ...owner,
            phase: 'MANUAL',
            reason: errorText(error),
          });
        await mutateJob(job.id, (state) => {
          if (state.disposableSource)
            state.disposableSource.cleanupStatus = 'MANUAL';
        });
      }
      continue;
    }
    if (stored?.tabId === job.tabId) {
      workspace.viewportWorkspaces.set(job.id, stored);
      try {
        await waitForCaptureRelease({
          guard: async () => undefined,
          released: async () =>
            !(await chrome.tabCapture.getCapturedTabs()).some(
              (value) =>
                value.tabId === job.tabId &&
                ['active', 'pending'].includes(value.status),
            ),
          wait: sleep,
        });
        // Recovery has a persisted owned workspace and a measured pre-attach
        // viewport. Remove our debugger before moving its still-active tab.
        if (job.advancedPointer)
          await clearEmulatedViewport(job.tabId).catch(() => undefined);
        await restoreWorkspace(job.id, job.advancedPointer === true);
      } catch (error) {
        await mutateJob(job.id, (state) => {
          state.limitations.push(
            `VIEWPORT_WORKSPACE_RESTART_RELEASE_UNCONFIRMED: ${errorText(error)}`,
          );
        });
      }
    }
    await recordUnownedWorkspace(job.id);
    const retainedPointer = workspace.pointerSessions.get(job.id);
    if (retainedPointer) {
      await clearEmulatedViewport(job.tabId).catch(() => undefined);
      await releasePointerOwner(job.id, retainedPointer).catch(
        async (error) => {
          await mutateJob(job.id, (current) => {
            current.limitations.push(
              `DEBUGGER_RELEASE_UNCONFIRMED: ${errorText(error)}`,
            );
          });
        },
      );
    }
    if (!TERMINAL_STATES.includes(job.state) && job.state !== 'PAUSED') {
      if (job.advancedPointer && chrome.debugger) {
        await clearEmulatedViewport(job.tabId).catch(() => undefined);
        await detachPointerSession(job.tabId);
      }
      await mutateJob(job.id, (current) => {
        current.state = 'INTERRUPTED';
        current.stopIntent = true;
        current.endedAt = now();
        current.stopReason = 'BROWSER_OR_WORKER_RESTART';
        current.limitations.push(
          'RUNNER_INTERRUPTED: capture continuity cannot be recovered after a worker restart.',
        );
      });
    }
  }
  await offscreen('CAPTURE_STOP').catch(() => undefined);
  await applyRetention();
  await chrome.action.setBadgeText({ text: '' });
})();

chrome.permissions.onAdded.addListener(() => {
  void initialized.then(continueStartIntent).catch(() => undefined);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    message?.target === 'offscreen' ||
    (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')))
  )
    return;
  void handle(message).then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, error: errorText(error) }),
  );
  return true;
});
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (
    message?.type !== 'FLASHGUARD_IMPORT' ||
    typeof message.nonce !== 'string' ||
    message.nonce.length > 100 ||
    !trustedTransferSender(sender, __WEB_ORIGIN__)
  ) {
    respond({ ok: false, error: 'Invalid transfer request' });
    return;
  }
  void (async () => {
    await initialized;
    const transfer = await consumeTransfer(message.nonce, sender.tab.id);
    if (!transfer)
      throw new Error('Transfer expired, consumed or opened in another tab');
    if (
      !transfer.snapshot ||
      (await contentHash(transfer.snapshot)) !== transfer.contentHash
    )
      throw new Error(
        'Transfer snapshot is unavailable or changed; reopen the upload preview.',
      );
    return transfer.snapshot;
  })().then(
    (report) => respond({ ok: true, report }),
    (error) => respond({ ok: false, error: errorText(error) }),
  );
  return true;
});
chrome.tabs.onZoomChange.addListener(({ tabId }) => {
  capture.pageZoomRevisions.set(
    tabId,
    (capture.pageZoomRevisions.get(tabId) ?? 0) + 1,
  );
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (closingAdvancedTabs.has(tabId)) return;
  capture.pageZoomRevisions.delete(tabId);
  void initialized.then(async () => {
    await reconcileMissingAdvancedTab();
    for (const job of await listJobs())
      if (job.tabId === tabId && !TERMINAL_STATES.includes(job.state)) {
        await mutateJob(job.id, (state) => {
          state.state = 'INTERRUPTED';
          state.stopIntent = true;
          state.stopReason = 'SCAN_TAB_CLOSED';
          state.endedAt = now();
        });
        await offscreen('CAPTURE_STOP', { generation: job.generation }).catch(
          () => undefined,
        );
      }
  });
});
chrome.debugger?.onDetach.addListener((source, reason) => {
  const entry = [...workspace.pointerSessions].find(
    ([, session]) => session.tabId === source.tabId,
  );
  if (!entry) return;
  const [id, session] = entry;
  if (workspace.intentionalPointerDetaches.has(session)) return;
  workspace.pointerSessions.delete(id);
  void (async () => {
    const stored = (
      await chrome.storage.session.get(pointerKey(session.tabId))
    )[pointerKey(session.tabId)] as StoredPointerSession | undefined;
    if (stored?.jobId === id && stored.generation === session.generation)
      await chrome.storage.session.remove(pointerKey(session.tabId));
    await mutateJob(id, (job) => {
      if (
        job.generation !== session.generation ||
        TERMINAL_STATES.includes(job.state)
      )
        return;
      job.state = 'INTERRUPTED';
      job.stopIntent = true;
      job.endedAt = now();
      job.stopReason = `DEBUGGER_SESSION_LOST: ${reason}`;
      job.limitations.push('TRUSTED_POINTER_SESSION_INTERRUPTED');
    });
    await chrome.tabs
      .sendMessage(session.tabId, { type: 'FG_CANCEL' })
      .catch(() => undefined);
    await offscreen('CAPTURE_STOP', { generation: session.generation }).catch(
      () => undefined,
    );
  })();
});
