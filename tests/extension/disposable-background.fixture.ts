import { afterEach, beforeEach, expect, vi } from 'vitest';

import {
  ADVANCED_SCAN_OWNER_KEY,
  type DisposableScanOwner,
} from '../../apps/chrome-extension/src/disposable-scan';
import { event, fixtureMemory } from './disposable-memory.fixture';

vi.mock('../../apps/chrome-extension/src/store', () => memory.store);

export async function runtimeFixture(
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

export const memory = fixtureMemory();
