import { describe, expect, it } from 'vitest';

import {
  ADVANCED_SCAN_OWNER_KEY,
  type DisposableScanOwner,
} from '../../apps/chrome-extension/src/disposable-scan';
import { memory, runtimeFixture } from './disposable-background.fixture';
describe('disposable background lifecycle with mocked Chrome runtime', () => {
  it.each([false, true])(
    'reconciles a missing owned scan on worker restart and confirms debugger release failure=%s before forgetting its pointer receipt',
    async (detachFails) => {
      const jobId = 'restart-job',
        generation = 'restart-generation',
        nonce = 'restart-owner';
      const pointerKey = 'pointer-session:40';
      const f = await runtimeFixture(
        ({ session, source, window, context, chrome }) => {
          const owner: DisposableScanOwner = {
            version: 1,
            nonce,
            phase: 'RUNNING',
            createdAt: Date.now() - 1000,
            source: {
              tabId: source.id,
              windowId: source.windowId,
              index: source.index,
              url: source.url,
              context: structuredClone(context),
              window: {
                width: window.width,
                height: window.height,
                left: window.left,
                top: window.top,
              },
            },
            foreground: { tabId: source.id, windowId: source.windowId },
            route: source.url,
            mode: 'EXTENDED',
            viewportSeconds: 30,
            scanTabId: 40,
            scanWindowId: 1,
            jobId,
            generation,
          };
          session.set(ADVANCED_SCAN_OWNER_KEY, owner);
          session.set(pointerKey, { jobId, generation, tabId: 40 });
          session.set(`viewport-workspace:${jobId}`, {
            tabId: 40,
            windowId: 2,
            originalWindowId: 1,
          });
          session.set(`viewport-workspace-intent:${jobId}`, {
            tabId: 40,
            originalWindowId: 1,
            originalIndex: 3,
          });
          memory.jobs.set(jobId, {
            id: jobId,
            generation,
            tabId: 40,
            advancedPointer: true,
            disposableSource: {
              nonce,
              originalTabId: 11,
              originalUrl: source.url,
              closed: false,
              cleanupStatus: 'RETAINED',
            },
            origin: new URL(source.url).origin,
            startUrl: source.url,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            state: 'RUNNING',
            stopIntent: false,
            elapsedMs: 100,
            tasks: [],
            skippedLinks: 0,
            limitations: [],
            mode: 'EXTENDED',
          });
          let attached = true;
          chrome.debugger.detach.mockImplementation(
            async ({ tabId }: { tabId: number }) => {
              expect(tabId).toBe(40);
              expect(session.has(pointerKey)).toBe(true);
              if (detachFails) throw new Error('NATIVE_DETACH_FAILED');
              attached = false;
            },
          );
          chrome.debugger.getTargets.mockImplementation(async () =>
            attached ? [{ tabId: 40, attached: true }] : [],
          );
        },
      );
      const state = await f.request({ type: 'GET_STATE', inspectedTabId: 11 });
      expect(state.ok).toBe(true);
      expect(f.chrome.debugger.detach).toHaveBeenCalledExactlyOnceWith({
        tabId: 40,
      });
      expect(f.chrome.debugger.getTargets).toHaveBeenCalled();
      expect(f.session.has(ADVANCED_SCAN_OWNER_KEY)).toBe(false);
      expect(f.session.has(`viewport-workspace:${jobId}`)).toBe(false);
      expect(f.session.has(`viewport-workspace-intent:${jobId}`)).toBe(false);
      expect(f.session.has(pointerKey)).toBe(detachFails);
      const job = memory.jobs.get(jobId);
      expect(job.disposableSource).toMatchObject({
        closed: true,
        cleanupStatus: 'CLOSED',
      });
      expect(
        job.limitations.some((value: string) =>
          value.includes('DEBUGGER_RELEASE_UNCONFIRMED'),
        ),
      ).toBe(detachFails);
      expect(f.chrome.tabs.remove).not.toHaveBeenCalled();
      expect(f.chrome.tabs.create).not.toHaveBeenCalled();
    },
  );

  it('PREPARE persists ownership before making only an owned tab, without a capture grant, capture start or debugger attach', async () => {
    const f = await runtimeFixture();
    const before = structuredClone({ ...f.source, active: false });
    expect(await f.prepare()).toEqual({ ok: true, value: { tabId: 40 } });
    expect(f.chrome.tabs.create).toHaveBeenCalledOnce();
    expect(f.source).toEqual(before);
    expect(f.session.get(ADVANCED_SCAN_OWNER_KEY)).toMatchObject({
      phase: 'PREPARED',
      scanTabId: 40,
      scanWindowId: 1,
      source: { tabId: 11 },
    });
    expect(f.chrome.tabCapture.getMediaStreamId).not.toHaveBeenCalled();
    expect(f.chrome.debugger.attach).not.toHaveBeenCalled();
    expect(f.chrome.offscreen.createDocument).not.toHaveBeenCalled();
    expect(
      f.chrome.runtime.sendMessage.mock.calls.some(
        ([message]: any[]) => message.type === 'CAPTURE_START',
      ),
    ).toBe(false);
    expect(memory.store.createJob).not.toHaveBeenCalled();
  });

  it('rejects advanced START on the original tab without an owner before creating a job or capture', async () => {
    const f = await runtimeFixture();
    const result = await f.request({
      type: 'START',
      tabId: 11,
      mode: 'EXTENDED',
      viewportSeconds: 30,
      advancedPointer: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain(
      'Bereid eerst een apart geavanceerd scantabblad',
    );
    expect(memory.store.createJob).not.toHaveBeenCalled();
    expect(f.chrome.tabCapture.getMediaStreamId).not.toHaveBeenCalled();
    expect(f.chrome.debugger.attach).not.toHaveBeenCalled();
    expect(f.chrome.tabs.create).not.toHaveBeenCalled();
  });
});
