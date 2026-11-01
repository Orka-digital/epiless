import { waitForCaptureRelease } from './capture-source';
import { type ScanJob, TERMINAL_STATES } from './model';
import { WorkspaceOwner } from './runner-runtime';
import type { StoredPointerSession } from './runner-types';
import { applyRetention, listJobs, mutateJob } from './store';
import { detachPointerSession } from './trusted-pointer';
import { clearEmulatedViewport } from './viewport-driver';
import { type ViewportWorkspace } from './viewport-workspace';

import type { RunnerOperations } from './runner-contracts';
type RecoveryServices = Pick<
  RunnerOperations,
  | 'offscreen'
  | 'reconcileMissingAdvancedTab'
  | 'pointerKey'
  | 'workspaceKey'
  | 'releasePointerOwner'
  | 'errorText'
  | 'sleep'
  | 'restoreWorkspace'
  | 'now'
  | 'finalizeAdvancedJob'
  | 'loadAdvancedOwner'
  | 'persistAdvancedOwner'
  | 'recordUnownedWorkspace'
> & { workspace: WorkspaceOwner };
/** Reconcile persisted ownership after worker restart; incomplete capture never resumes silently. */
export async function recoverRunner(services: RecoveryServices) {
  const {
    offscreen,
    reconcileMissingAdvancedTab,
    pointerKey,
    workspaceKey,
    releasePointerOwner,
    errorText,
    sleep,
    restoreWorkspace,
    now,
    recordUnownedWorkspace,
    workspace,
  } = services;

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
      await recoverDisposableJob(services, job, stored);
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
}

async function recoverDisposableJob(
  services: RecoveryServices,
  job: ScanJob,
  stored: ViewportWorkspace | undefined,
): Promise<void> {
  const {
    workspace,
    releasePointerOwner,
    errorText,
    sleep,
    restoreWorkspace,
    now,
    finalizeAdvancedJob,
    loadAdvancedOwner,
    persistAdvancedOwner,
  } = services;
  if (!job.disposableSource) return;

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
    return;
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
  return;
}
