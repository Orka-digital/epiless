import { describe, expect, it, vi } from 'vitest';

import {
  ADVANCED_SCAN_OWNER_KEY,
  type DisposableScanOwner,
} from '../../apps/chrome-extension/src/disposable-scan';
import { memory, runtimeFixture } from './disposable-background.fixture';
describe('disposable background lifecycle with mocked Chrome runtime', () => {
  it('serializes concurrent PREPARE requests before creation and preserves the first persisted intent', async () => {
    const f = await runtimeFixture();
    const create = f.chrome.tabs.create.getMockImplementation()!;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.chrome.tabs.create.mockImplementation(async (properties) => {
      await gate;
      return create(properties);
    });
    const first = f.prepare();
    const second = f.prepare();
    await vi.waitFor(
      () => expect(f.chrome.tabs.create).toHaveBeenCalledOnce(),
      { timeout: 500, interval: 5 },
    );
    const firstIntent = structuredClone(f.session.get(ADVANCED_SCAN_OWNER_KEY));
    const rejected = await second;
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('bestaande geavanceerde voorbereiding');
    expect(f.session.get(ADVANCED_SCAN_OWNER_KEY)).toEqual(firstIntent);
    expect(
      f.sessionWrites.filter(
        (write) =>
          (write[ADVANCED_SCAN_OWNER_KEY] as DisposableScanOwner | undefined)
            ?.phase === 'CREATE_INTENT',
      ),
    ).toHaveLength(1);
    finish();
    expect(await first).toEqual({ ok: true, value: { tabId: 40 } });
    expect(f.chrome.tabs.create).toHaveBeenCalledOnce();
    expect(f.session.get(ADVANCED_SCAN_OWNER_KEY).nonce).toBe(
      firstIntent.nonce,
    );
  });

  it('CANCEL closes only the prepared owned tab and clears its receipt after confirmed removal', async () => {
    const f = await runtimeFixture();
    expect((await f.prepare()).ok).toBe(true);
    expect(
      await f.request({ type: 'CANCEL_ADVANCED_SCAN', tabId: 40 }),
    ).toEqual({ ok: true, value: {} });
    expect(f.chrome.tabs.remove).toHaveBeenCalledExactlyOnceWith(40);
    expect(f.tabs.has(11)).toBe(true);
    expect(f.tabs.has(40)).toBe(false);
    expect(f.session.has(ADVANCED_SCAN_OWNER_KEY)).toBe(false);
    expect(f.chrome.debugger.attach).not.toHaveBeenCalled();
    expect(f.chrome.tabCapture.getMediaStreamId).not.toHaveBeenCalled();
  });

  it('retains MANUAL ownership and deletes no tab if the original document changes before cancellation', async () => {
    const f = await runtimeFixture();
    expect((await f.prepare()).ok).toBe(true);
    f.context.documentToken = 'replacement-original-document';
    const result = await f.request({ type: 'CANCEL_ADVANCED_SCAN', tabId: 40 });
    expect(result.ok).toBe(false);
    expect(f.chrome.tabs.remove).not.toHaveBeenCalled();
    expect(f.session.get(ADVANCED_SCAN_OWNER_KEY)).toMatchObject({
      phase: 'MANUAL',
      scanTabId: 40,
      reason: 'ADVANCED_ORIGINAL_CONTEXT_CHANGED',
    });
    expect(f.tabs.has(11)).toBe(true);
    expect(f.tabs.has(40)).toBe(true);
  });

  it('bounds a hanging cleanup context read and never removes a tab after its late response', async () => {
    const f = await runtimeFixture();
    expect((await f.prepare()).ok).toBe(true);
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'],
    });
    let finish!: (value: { ok: boolean; value: typeof f.context }) => void;
    f.chrome.tabs.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const cancel = f.request({ type: 'CANCEL_ADVANCED_SCAN', tabId: 40 }, 6000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await cancel;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('handmatige herstelmelding');
    expect(f.chrome.tabs.remove).not.toHaveBeenCalled();
    expect(f.tabs.has(40)).toBe(true);
    finish({ ok: true, value: structuredClone(f.context) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.chrome.tabs.remove).not.toHaveBeenCalled();
    expect(f.session.has(ADVANCED_SCAN_OWNER_KEY)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reconciles user removal of the known PREPARED scan without deleting or recreating any tab', async () => {
    const f = await runtimeFixture();
    expect((await f.prepare()).ok).toBe(true);
    f.tabs.delete(40);
    f.source.active = true;
    f.onRemoved.emit(40, { windowId: 1, isWindowClosing: false });
    await vi.waitFor(
      () => expect(f.session.has(ADVANCED_SCAN_OWNER_KEY)).toBe(false),
      { timeout: 1000, interval: 10 },
    );
    expect(f.chrome.tabs.remove).not.toHaveBeenCalled();
    expect(f.chrome.tabs.create).toHaveBeenCalledOnce();
    expect(f.tabs.has(11)).toBe(true);
    expect(memory.store.createJob).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'manual removal reconciles its owner and clears only matching pending recheck=%s',
    async (matching) => {
      const f = await runtimeFixture();
      expect((await f.prepare()).ok).toBe(true);
      const replayOf = {
        jobId: 'old-job',
        taskId: 'old-task',
        observationId: 'old-observation',
      };
      const owner = f.session.get(
        ADVANCED_SCAN_OWNER_KEY,
      ) as DisposableScanOwner;
      f.session.set(ADVANCED_SCAN_OWNER_KEY, {
        ...owner,
        phase: 'MANUAL',
        replayOf,
        reason: 'ORIGINAL_CONTEXT_CHANGED',
      });
      const pending = {
        tabId: 40,
        route: owner.route,
        replayOf: matching
          ? replayOf
          : { ...replayOf, observationId: 'another-observation' },
      };
      memory.control.set('recheck', structuredClone(pending));
      f.tabs.delete(40);
      f.source.active = true;
      f.onRemoved.emit(40, { windowId: 1, isWindowClosing: false });
      await vi.waitFor(
        () => {
          expect(f.session.has(ADVANCED_SCAN_OWNER_KEY)).toBe(false);
          expect(memory.control.get('recheck')).toEqual(
            matching ? undefined : pending,
          );
        },
        { timeout: 1000, interval: 10 },
      );
      expect(f.chrome.tabs.remove).not.toHaveBeenCalled();
      expect(f.tabs.has(11)).toBe(true);
    },
  );
});
