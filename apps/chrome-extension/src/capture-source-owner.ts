import type { CaptureViewport } from './capture-quality';

import { reopenCaptureSource, waitForCaptureRelease } from './capture-source';

import type { PointerSession, StoredPointerSession } from './runner-types';

import { sameViewport } from './scenario-plan';

import { getJob, mutateJob } from './store';

import { releaseOwnedPointerSession } from './trusted-pointer';

import type { CaptureServices } from './runner-capture-services';
/** Own source acquisition and release; retain failed capture coverage explicitly. */
export function createCaptureSourceOwner(services: CaptureServices) {
  async function releasePointerOwner(
    id: string,
    session: PointerSession,
  ): Promise<void> {
    await releaseOwnedPointerSession({
      session,
      current: () => services.workspace.pointerSessions.get(id),
      intentional: services.workspace.intentionalPointerDetaches,
      forget: async () => {
        const stored = (
          await chrome.storage.session.get(services.pointerKey(session.tabId))
        )[services.pointerKey(session.tabId)] as
          StoredPointerSession | undefined;
        if (stored?.jobId === id && stored.generation === session.generation)
          await chrome.storage.session.remove(
            services.pointerKey(session.tabId),
          );
        if (services.workspace.pointerSessions.get(id) === session)
          services.workspace.pointerSessions.delete(id);
      },
    });
  }

  async function releaseCaptureSource(id: string, generation: string) {
    const source = services.capture.captureSources.get(id);
    if (!source || source.generation !== generation) return;
    source.active = false;
    await services.offscreen('CAPTURE_STOP', {
      generation,
      sourceId: source.sourceId,
    });
    const job = await getJob(id);
    if (!job || job.generation !== generation) return;
    await waitForCaptureRelease({
      guard: async () => {
        const current = services.capture.captureSources.get(id);
        if (
          current &&
          (current.generation !== generation ||
            current.sourceId !== source.sourceId)
        )
          throw new Error('CAPTURE_SOURCE_CHANGED_DURING_RELEASE');
      },
      released: async () =>
        !(await chrome.tabCapture.getCapturedTabs()).some(
          (capture) =>
            capture.tabId === job.tabId &&
            ['active', 'pending'].includes(capture.status),
        ),
      wait: services.sleep,
    });
  }

  async function prepareCaptureSource(
    id: string,
    generation: string,
    viewport: CaptureViewport,
  ) {
    const previous = services.capture.captureSources.get(id);
    if (!previous || previous.generation !== generation)
      throw new Error('CAPTURE_SOURCE_LEASE_UNAVAILABLE');
    if (previous.active && sameViewport(previous.viewport, viewport))
      return previous.sourceId;
    const job = await services.guard(id, generation);
    const sourceId = crypto.randomUUID();
    services.capture.captureSources.set(id, {
      generation,
      sourceId,
      viewport: { ...viewport },
      active: false,
    });
    try {
      await reopenCaptureSource(
        viewport,
        {
          guard: () => services.guard(id, generation),
          stop: () =>
            services.offscreen('CAPTURE_STOP', {
              generation,
              sourceId: previous.sourceId,
            }),
          released: async () =>
            !(await chrome.tabCapture.getCapturedTabs()).some(
              (capture) =>
                capture.tabId === job.tabId &&
                ['active', 'pending'].includes(capture.status),
            ),
          token: () =>
            chrome.tabCapture.getMediaStreamId({ targetTabId: job.tabId }),
          start: (streamId, sourceId, expectedViewport) =>
            services.offscreen('CAPTURE_START', {
              generation,
              sourceId,
              streamId,
              expectedViewport,
            }),
          cancel: (sourceId) =>
            services.offscreen('CAPTURE_STOP', { generation, sourceId }),
          wait: services.sleep,
        },
        sourceId,
      );
    } catch (error) {
      const reason = services.errorText(error);
      if (
        [
          'RUNNER_CANCELLED',
          'BUDGET_REACHED',
          'ORIGIN_CHANGED',
          'PERMISSION_REVOKED',
        ].includes(reason)
      )
        throw error;
      throw new Error(`CAPTURE_SOURCE_REOPEN_FAILED: ${reason}`, {
        cause: error,
      });
    }
    services.capture.captureSources.set(id, {
      generation,
      sourceId,
      viewport: { ...viewport },
      active: true,
    });
    return sourceId;
  }

  async function recordUnobserved(
    id: string,
    taskId: string,
    scenario: string,
    reason: string,
    coverage: 'SKIPPED' | 'UNREACHED' = 'SKIPPED',
  ) {
    await mutateJob(id, (job) => {
      const task = job.tasks.find((value) => value.id === taskId);
      if (!task) return;
      task.observations.push({
        id: crypto.randomUUID(),
        scenario,
        startedAt: services.now(),
        endedAt: services.now(),
        achieved: false,
        reason,
        coverage,
      });
      task.reasons.push(`${scenario}: ${reason}`);
    });
  }
  return {
    releasePointerOwner,
    releaseCaptureSource,
    prepareCaptureSource,
    recordUnobserved,
  };
}
