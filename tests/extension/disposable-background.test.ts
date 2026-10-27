import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADVANCED_SCAN_OWNER_KEY,
  type DisposableScanOwner,
} from '../../apps/chrome-extension/src/disposable-scan';

const memory = vi.hoisted(() => {
  const jobs = new Map<string, any>();
  const control = new Map<string, any>();
  return {
    jobs,
    control,
    store: {
      listJobs: vi.fn(async () => structuredClone([...jobs.values()])),
      getJob: vi.fn(async (id: string) =>
        jobs.has(id) ? structuredClone(jobs.get(id)) : undefined,
      ),
      mutateJob: vi.fn(async (id: string, update: (job: any) => void) => {
        const job = jobs.get(id);
        if (!job) return;
        update(job);
        return structuredClone(job);
      }),
      createJob: vi.fn(async (job: any) => {
        jobs.set(job.id, structuredClone(job));
      }),
      resumeLease: vi.fn(async () => undefined),
      deleteJob: vi.fn(async (id: string) => {
        jobs.delete(id);
      }),
      putTransfer: vi.fn(async () => undefined),
      consumeTransfer: vi.fn(async () => undefined),
      putStartIntent: vi.fn(async (value: any) => {
        control.set('start', structuredClone(value));
      }),
      getStartIntent: vi.fn(async () => control.get('start')),
      consumeStartIntent: vi.fn(async () => {
        const value = control.get('start');
        control.delete('start');
        return value;
      }),
      applyRetention: vi.fn(async () => undefined),
      getHistorySettings: vi.fn(async () => ({
        schemaVersion: 1,
        detailRetentionDays: 90,
      })),
      setHistorySettings: vi.fn(async () => undefined),
      deleteHistory: vi.fn(async () => undefined),
      getScanPreferences: vi.fn(async () => ({
        mode: 'AUTONOMOUS',
        viewportSeconds: 30,
      })),
      setScanPreferences: vi.fn(async () => undefined),
      getPendingRecheck: vi.fn(async () => control.get('recheck')),
      setPendingRecheck: vi.fn(async (value: any) => {
        control.set('recheck', value);
      }),
    },
  };
});
vi.mock('../../apps/chrome-extension/src/store', () => memory.store);

function event() {
  const listeners: Array<(...args: any[]) => any> = [];
  return {
    listeners,
    addListener: vi.fn((listener: (...args: any[]) => any) => {
      listeners.push(listener);
    }),
    removeListener: vi.fn((listener: (...args: any[]) => any) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }),
    emit: (...args: any[]) =>
      listeners.forEach((listener) => listener(...args)),
  };
}

async function runtimeFixture(
  preload?: (state: {
    session: Map<string, any>;
    source: any;
    window: any;
    context: any;
    chrome: any;
  }) => void,
) {
  const source = {
    id: 11,
    windowId: 1,
    index: 2,
    url: 'https://fixture.test/page',
    active: true,
    pinned: false,
    groupId: -1,
  };
  const tabs = new Map<number, any>([[11, source]]);
  const window = {
    id: 1,
    width: 900,
    height: 650,
    left: 20,
    top: 20,
    focused: true,
  };
  const context = {
    url: source.url,
    documentToken: 'original-document',
    viewportRevision: 0,
    viewport: {
      width: 900,
      height: 507,
      dpr: 2,
      scrollX: 0,
      scrollY: 0,
      visualScale: 1,
      visualOffsetLeft: 0,
      visualOffsetTop: 0,
    },
  };
  const session = new Map<string, any>();
  const sessionWrites: Record<string, unknown>[] = [];
  const onMessage = event(),
    onRemoved = event();
  const chrome = {
    runtime: {
      id: 'owned-test-extension',
      getURL: (path: string) =>
        `chrome-extension://owned-test-extension/${path}`,
      getManifest: () => ({
        permissions: ['debugger', 'tabCapture', 'storage', 'scripting'],
      }),
      onMessage,
      onMessageExternal: event(),
      sendMessage: vi.fn(async () => ({ ok: true, value: {} })),
      getContexts: vi.fn(async () => []),
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    },
    storage: {
      session: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => session.has(key))
              .map((key) => [key, structuredClone(session.get(key))]),
          ),
        ),
        set: vi.fn(async (values: Record<string, unknown>) => {
          sessionWrites.push(structuredClone(values));
          for (const [key, value] of Object.entries(values))
            session.set(key, structuredClone(value));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys])
            session.delete(key);
        }),
      },
    },
    tabs: {
      onRemoved,
      onUpdated: event(),
      onZoomChange: event(),
      get: vi.fn(async (id: number) => {
        if (!tabs.has(id)) throw new Error('NO_SUCH_TAB');
        return structuredClone(tabs.get(id));
      }),
      query: vi.fn(
        async (query: { active?: boolean; windowId?: number } = {}) =>
          structuredClone(
            [...tabs.values()].filter(
              (tab) =>
                (query.active === undefined || tab.active === query.active) &&
                (query.windowId === undefined ||
                  tab.windowId === query.windowId),
            ),
          ),
      ),
      sendMessage: vi.fn(async (id: number, message: { type: string }) => {
        if (id === 11 && message.type === 'FG_DIAGNOSTIC_CONTEXT')
          return { ok: true, value: structuredClone(context) };
        throw new Error(`UNEXPECTED_CONTENT_MESSAGE:${message.type}`);
      }),
      create: vi.fn(async (properties: any) => {
        const owner = session.get(
          ADVANCED_SCAN_OWNER_KEY,
        ) as DisposableScanOwner;
        expect(owner.phase).toBe('CREATE_INTENT');
        expect(owner.scanTabId).toBeUndefined();
        expect(properties).toMatchObject({
          windowId: 1,
          index: 3,
          openerTabId: 11,
          url: source.url,
          active: true,
        });
        for (const tab of tabs.values())
          if (tab.windowId === properties.windowId) tab.active = false;
        const tab = { ...properties, id: 40, pinned: false, groupId: -1 };
        tabs.set(40, tab);
        return structuredClone(tab);
      }),
      remove: vi.fn(async (id: number) => {
        expect(id).toBe(40);
        expect(session.get(ADVANCED_SCAN_OWNER_KEY)?.phase).toBe('CLOSING');
        tabs.delete(id);
        source.active = true;
        onRemoved.emit(id, { windowId: 1, isWindowClosing: false });
      }),
      update: vi.fn(async () => {
        throw new Error('UNEXPECTED_TAB_UPDATE');
      }),
    },
    windows: {
      get: vi.fn(async (id: number) => {
        if (id !== 1) throw new Error('NO_SUCH_WINDOW');
        return structuredClone(window);
      }),
    },
    permissions: { contains: vi.fn(async () => true), onAdded: event() },
    scripting: { executeScript: vi.fn(async () => []) },
    action: { setBadgeText: vi.fn(async () => {}) },
    tabCapture: {
      getCapturedTabs: vi.fn(async () => []),
      getMediaStreamId: vi.fn(async () => 'FORBIDDEN_STREAM'),
    },
    debugger: {
      getTargets: vi.fn(async () => []),
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      sendCommand: vi.fn(async () => ({})),
      onDetach: event(),
    },
    offscreen: {
      createDocument: vi.fn(async () => {}),
      Reason: { USER_MEDIA: 'USER_MEDIA' },
    },
  };
  vi.stubGlobal('chrome', chrome);
  vi.stubGlobal('__WEB_ORIGIN__', 'https://epiless.test');
  preload?.({ session, source, window, context, chrome });
  await import('../../apps/chrome-extension/src/background');
  expect(onMessage.listeners).toHaveLength(1);
  const request = (message: Record<string, unknown>, timeoutMs = 1000) =>
    new Promise<{ ok: boolean; value?: any; error?: string }>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('MOCK_RUNTIME_RESPONSE_TIMEOUT')),
          timeoutMs,
        );
        const accepted = onMessage.listeners[0](
          message,
          { id: chrome.runtime.id },
          (response: any) => {
            clearTimeout(timeout);
            resolve(response);
          },
        );
        if (accepted !== true) {
          clearTimeout(timeout);
          reject(new Error('MOCK_RUNTIME_MESSAGE_REJECTED'));
        }
      },
    );
  const prepare = () =>
    request({
      type: 'PREPARE_ADVANCED_SCAN',
      tabId: 11,
      mode: 'EXTENDED',
      viewportSeconds: 30,
    });
  return {
    chrome,
    source,
    tabs,
    window,
    context,
    session,
    sessionWrites,
    request,
    prepare,
    onRemoved,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  memory.jobs.clear();
  memory.control.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Mocked service-worker integration: this does not prove native browser capture,
 * viewport restoration, activeTab grants or operating-system focus behavior. */
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
