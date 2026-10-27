import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

it('wakes on real-message shapes with the interval fully suspended and coalesces busy polls', async () => {
  // This exercises only the controller scheduler with mocked APIs. It never
  // creates a browser, capture stream, native evidence record or success claim.
  const source = await readFile(
    new URL('./native-context-controller.js', import.meta.url),
    'utf8',
  );
  let listener: (message: any, sender: any) => void;
  const pending: Array<(value: unknown) => void> = [];
  let concurrent = 0,
    maximumConcurrent = 0;
  const sendMessage = vi.fn((message) => {
    expect(message.type).toBe('GET_STATE');
    concurrent++;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    return new Promise((resolve) => pending.push(resolve)).finally(
      () => concurrent--,
    );
  });
  const interval = vi.fn(); // Intentionally never executes its callback.
  await vm.runInNewContext(source, {
    fetch: async (url: string) => ({
      ok: true,
      json: async () => ({ mode: 'cancel', origin: 'http://127.0.0.1:1' }),
    }),
    chrome: {
      runtime: {
        id: 'fixture',
        sendMessage,
        onMessage: {
          addListener: (callback: typeof listener) => {
            listener = callback;
          },
        },
      },
      tabs: { onZoomChange: { addListener() {} } },
    },
    queueMicrotask,
    setInterval: interval,
    setTimeout,
    clearTimeout,
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const emit = (kind: string, sender = 'fixture') =>
    listener(
      { type: 'FIXTURE_CONTEXT_EVIDENCE', event: { kind } },
      { id: sender },
    );
  expect(interval).toHaveBeenCalledOnce();
  expect(sendMessage).toHaveBeenCalledTimes(1);
  // While one GET_STATE is pending, a burst of accepted-frame notifications
  // must request exactly one trailing poll, without parallel state mutations.
  for (let i = 0; i < 30; i++) emit('FRAME_DONE');
  expect(sendMessage).toHaveBeenCalledTimes(1);
  pending.shift()!({ ok: true, value: { jobs: [] } });
  await settle();
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(maximumConcurrent).toBe(1);
  pending.shift()!({ ok: true, value: { jobs: [] } });
  await settle();
  emit('WORKER_CANDIDATE');
  await settle();
  expect(sendMessage).toHaveBeenCalledTimes(3);
  pending.shift()!({ ok: true, value: { jobs: [] } });
  await settle();
  emit('SEGMENT_BEGIN', 'different-extension');
  await settle();
  expect(sendMessage).toHaveBeenCalledTimes(3);
  expect(maximumConcurrent).toBe(1);
});

it('records the original before preparation and passively observes the real prepared owner without issuing PREPARE or START', async () => {
  // API mocks validate only fixture authority and collection order, never native
  // capture acceptance. There is no real browser or stored native evidence here.
  const source = await readFile(
    new URL('./native-context-controller.js', import.meta.url),
    'utf8',
  );
  const origin = 'http://127.0.0.1:1';
  let listener: (message: any, sender: any) => void;
  let owner: any;
  let geometry = {
    at: Date.now(),
    documentId: 'original-document-identity',
    width: 900,
    height: 450,
    dpr: 2,
    url: origin + '/',
    timeOrigin: 1,
  };
  const context = {
    documentToken: 'actual-content-document',
    url: origin + '/',
    viewport: { width: 900, height: 507, dpr: 2 },
  };
  const posts: Array<{ route: string; value: any }> = [];
  const sendMessage = vi.fn(async (message) => {
    expect(message.type).toBe('GET_STATE');
    return { ok: true, value: { jobs: [] } };
  });
  const executeScript = vi.fn(async () => [
    { result: { ...geometry, at: Date.now() } },
  ]);
  await vm.runInNewContext(source, {
    fetch: async (url: string, options?: any) => {
      if (options?.method === 'POST') {
        posts.push({
          route: url.slice(origin.length),
          value: JSON.parse(options.body),
        });
        return { ok: true };
      }
      return {
        ok: true,
        json: async () =>
          url === 'fixture-context-config.json'
            ? { mode: 'complete', ownedScan: true, origin }
            : { tab: { tabId: 2, windowId: 5, index: 2 }, geometry },
      };
    },
    chrome: {
      runtime: {
        id: 'fixture',
        sendMessage,
        onMessage: {
          addListener: (callback: typeof listener) => {
            listener = callback;
          },
        },
      },
      tabs: {
        onZoomChange: { addListener() {} },
        get: async (id: number) => ({
          id,
          windowId: 5,
          index: 2,
          active: !owner,
          url: origin + '/',
          pinned: false,
          groupId: -1,
        }),
        query: async () => [{ id: owner ? 3 : 2 }],
        getZoom: async () => 1,
        sendMessage: async () =>
          owner ? { ok: true, value: context } : { ok: false },
      },
      windows: {
        get: async () => ({
          id: 5,
          width: 900,
          height: 650,
          left: 0,
          top: 0,
          focused: true,
        }),
      },
      storage: {
        session: {
          get: async () => (owner ? { 'advanced-scan-owner': owner } : {}),
        },
      },
      scripting: { executeScript },
      tabCapture: { getCapturedTabs: async () => [] },
      debugger: { getTargets: async () => [] },
    },
    queueMicrotask,
    setInterval: vi.fn(),
    setTimeout,
    clearTimeout,
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const wake = () =>
    listener(
      { type: 'FIXTURE_CONTEXT_EVIDENCE', event: { kind: 'FRAME_DONE' } },
      { id: 'fixture' },
    );
  await settle();
  expect(sendMessage).not.toHaveBeenCalled(); // 450px is not accepted as 507px.
  geometry = { ...geometry, height: 507, at: Date.now() };
  wake();
  await settle();
  expect(posts.some(({ value }) => value.originalSnapshotReady)).toBe(true);
  expect(executeScript).not.toHaveBeenCalled(); // Initial page clock is independent of host access.
  expect(sendMessage).toHaveBeenCalledTimes(1);
  owner = { phase: 'PREPARED', scanTabId: 3, source: { tabId: 2, context } };
  wake();
  await settle();
  expect(posts.some(({ value }) => value.ownedPreparationObserved)).toBe(true);
  expect(executeScript).toHaveBeenCalledOnce();
  expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
    'GET_STATE',
    'GET_STATE',
  ]);
  expect(posts.some(({ value }) => value.fixtureError)).toBe(false);
});
