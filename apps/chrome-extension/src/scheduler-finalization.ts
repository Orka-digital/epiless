import { TERMINAL_STATES } from './model';

import { computeCompletion } from './runner-policy';

import type { SchedulerServices } from './runner-services';

import { getJob, mutateJob } from './store';

/** Stop capture and reconcile owned resources before persisting terminal coverage and stop reason. */
export async function finalizeScheduledJob(
  services: SchedulerServices,
  id: string,
  generation: string,
  stopReason: string,
): Promise<void> {
  // Cancellation and targeted replay must release the browser producer too;
  // track.stop() alone can leave its size constraints active during restore.
  try {
    await services.releaseCaptureSource(id, generation);
  } catch {
    stopReason = 'CAPTURE_SOURCE_RELEASE_UNCONFIRMED';
    await mutateJob(id, (job) => {
      if (!job.limitations.includes('CAPTURE_SOURCE_RELEASE_UNCONFIRMED'))
        job.limitations.push('CAPTURE_SOURCE_RELEASE_UNCONFIRMED');
    });
  }
  await services
    .offscreen('CAPTURE_STOP', { generation })
    .catch(() => undefined);
  services.capture.capturePixelRatios.delete(id);
  services.capture.captureSources.delete(id);
  const cleanupJob = await getJob(id);
  if (cleanupJob?.disposableSource) {
    if (cleanupJob.state === 'PAUSED') {
      await services.restoreEmulation(id);
      await services.restoreWorkspace(id);
    }
  } else {
    await services.restoreEmulation(id);
    try {
      await services.ensureTerminalDebuggerWorkspace(id, generation);
    } catch (error) {
      await mutateJob(id, (state) => {
        state.limitations.push(
          `DEBUGGER_VIEWPORT_RESTORE_UNCONFIRMED: ${services.errorText(error)}`,
        );
        state.stopIntent = true;
        if (!TERMINAL_STATES.includes(state.state)) {
          state.state = 'INTERRUPTED';
          state.stopReason = 'DEBUGGER_VIEWPORT_RESTORE_UNCONFIRMED';
          state.endedAt = services.now();
        }
      });
    }
    await services.restoreWorkspace(
      id,
      services.workspace.pointerSessions.has(id),
    );
    await services.recordUnownedWorkspace(id);
  }
  const session = services.workspace.pointerSessions.get(id);
  if (session) {
    try {
      await services.releasePointerOwner(id, session);
    } catch (error) {
      await mutateJob(id, (state) => {
        state.limitations.push(
          `DEBUGGER_RELEASE_UNCONFIRMED: ${services.errorText(error)}`,
        );
      });
    }
  }
  await services.restoreWindow(id);
  const existing = await getJob(id);
  if (existing)
    await chrome.tabs
      .sendMessage(existing.tabId, { type: 'FG_RESTORE' })
      .catch(() => undefined);
  await mutateJob(id, (state) => {
    if (
      state.generation !== generation ||
      ['PAUSED', 'INTERRUPTED', 'ERROR'].includes(state.state)
    )
      return;
    if (state.stopIntent || state.state === 'STOPPING') {
      state.state = 'PARTIAL';
      state.stopReason ??= 'USER_STOP';
    } else if (stopReason === 'QUEUE_EXHAUSTED') {
      state.state = computeCompletion(state);
      state.stopReason = stopReason;
    } else {
      state.state = ['BUDGET_REACHED'].includes(stopReason)
        ? 'PARTIAL'
        : 'INTERRUPTED';
      state.stopReason = stopReason;
    }
    state.endedAt = services.now();
  });
  await services.finalizeAdvancedJob(id, generation);
  await chrome.action.setBadgeText({ text: '' });
  services.execution.clearClock(generation);
}
