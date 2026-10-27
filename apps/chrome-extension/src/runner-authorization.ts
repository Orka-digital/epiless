import { type ScanJob } from './model';
import type { RunnerOperations } from './runner-contracts';
import type {
  CaptureOwner,
  ExecutionOwner,
  WorkspaceOwner,
} from './runner-runtime';
import { getJob, mutateJob } from './store';
import { attachPointerSession } from './trusted-pointer';
import { waitForStableViewport } from './viewport-driver';

// Worker services are injected lazily; module construction never starts a scan.
export function createRunnerAuthorization(
  services: Pick<
    RunnerOperations,
    | 'ensureOffscreen'
    | 'sleep'
    | 'pointerKey'
    | 'offscreen'
    | 'runJob'
    | 'releasePointerOwner'
    | 'errorText'
    | 'now'
    | 'finalizeAdvancedJob'
  > & {
    execution: ExecutionOwner;
    capture: CaptureOwner;
    workspace: WorkspaceOwner;
  },
) {
  async function authorize(job: ScanJob): Promise<void> {
    const releaseAuthorization = services.execution.beginAuthorization();
    const authorizationStillAllowed = async () => {
      const current = await getJob(job.id);
      if (
        !current ||
        current.generation !== job.generation ||
        current.state !== 'AUTHORIZING' ||
        current.stopIntent
      )
        throw new Error('RUNNER_CANCELLED');
    };
    try {
      await services.ensureOffscreen();
      await authorizationStillAllowed();
      const readInitialViewport = async () => {
        const value = (
          await chrome.scripting.executeScript({
            target: { tabId: job.tabId },
            func: () => ({
              width: innerWidth,
              height: innerHeight,
              dpr: devicePixelRatio,
            }),
          })
        )[0]?.result;
        if (!value) throw new Error('INITIAL_VIEWPORT_UNAVAILABLE');
        return value;
      };
      if (job.advancedPointer) {
        const viewport = await waitForStableViewport({
          read: readInitialViewport,
          wait: services.sleep,
          guard: authorizationStillAllowed,
        });
        const tab = await chrome.tabs.get(job.tabId);
        const original = await chrome.windows.get(tab.windowId);
        const restore =
          original.id !== undefined &&
          original.width &&
          original.height &&
          original.left !== undefined &&
          original.top !== undefined
            ? {
                viewport,
                window: {
                  id: original.id,
                  width: original.width,
                  height: original.height,
                  left: original.left,
                  top: original.top,
                },
              }
            : undefined;
        // Attach BEFORE native capture pins a source size. Otherwise the debugger
        // notice and producer constraints create different baseline/restore CSS heights.
        await attachPointerSession(job.tabId);
        const session = {
          tabId: job.tabId,
          generation: job.generation,
          restore,
        };
        services.workspace.pointerSessions.set(job.id, session);
        await chrome.storage.session.set({
          [services.pointerKey(job.tabId)]: { jobId: job.id, ...session },
        });
        await services.sleep(750);
        await authorizationStillAllowed();
      }
      const sourceViewport = job.advancedPointer
        ? await waitForStableViewport({
            read: readInitialViewport,
            wait: services.sleep,
            guard: authorizationStillAllowed,
          })
        : await readInitialViewport();
      if (!sourceViewport) throw new Error('INITIAL_VIEWPORT_UNAVAILABLE');
      services.capture.capturePixelRatios.set(job.id, sourceViewport.dpr);
      const sourceId = crypto.randomUUID();
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: job.tabId,
      });
      await authorizationStillAllowed();
      services.capture.captureSources.set(job.id, {
        generation: job.generation,
        sourceId,
        viewport: { ...sourceViewport },
        active: true,
      });
      await services.offscreen('CAPTURE_START', {
        streamId,
        generation: job.generation,
        sourceId,
        sourceViewport,
        expectedViewport: sourceViewport,
      });
      await authorizationStillAllowed();
      await mutateJob(job.id, (state) => {
        if (state.stopIntent || state.state !== 'AUTHORIZING')
          throw new Error('RUNNER_CANCELLED');
        state.state = 'RUNNING';
      });
      services.execution.startClock({
        id: job.id,
        generation: job.generation,
        started: performance.now(),
        priorMs: job.elapsedMs,
      });
      await chrome.action.setBadgeText({ text: 'SCAN' });
      await chrome.action.setBadgeBackgroundColor({ color: '#003f3b' });
      services.execution.trackRun(() =>
        services.runJob(job.id, job.generation),
      );
    } catch (error) {
      services.capture.capturePixelRatios.delete(job.id);
      services.capture.captureSources.delete(job.id);
      await services
        .offscreen('CAPTURE_STOP', { generation: job.generation })
        .catch(() => undefined);
      const pointer = services.workspace.pointerSessions.get(job.id);
      if (pointer?.generation === job.generation) {
        await services
          .releasePointerOwner(job.id, pointer)
          .catch(async (releaseError) => {
            await mutateJob(job.id, (state) => {
              state.limitations.push(
                `DEBUGGER_RELEASE_UNCONFIRMED: ${services.errorText(releaseError)}`,
              );
            });
          });
      }
      await mutateJob(job.id, (state) => {
        if (state.stopIntent || state.generation !== job.generation) return;
        state.state = 'INTERRUPTED';
        state.stopIntent = true;
        state.stopReason = `CAPTURE_AUTHORIZATION_FAILED: ${services.errorText(error)}`;
        state.endedAt = services.now();
      });
      await services.finalizeAdvancedJob(job.id, job.generation);
      throw new Error(
        'De capture kon niet starten. Activeer de te scannen tab en start via de epi-less-toolbar. ' +
          services.errorText(error),
      );
    } finally {
      releaseAuthorization();
    }
  }
  return { authorize };
}
