import { expect, vi } from 'vitest';

import {
  closeDisposableScan,
  type DisposableScanOwner,
} from '../../apps/chrome-extension/src/disposable-scan';

export function intent(): DisposableScanOwner {
  return {
    version: 1,
    nonce: 'one-creation-attempt',
    phase: 'CREATE_INTENT',
    createdAt: 123,
    source: {
      tabId: 11,
      windowId: 1,
      index: 2,
      url: 'https://fixture.test/original',
      context: {
        url: 'https://fixture.test/original',
        documentToken: 'original-document',
        viewportRevision: 3,
        viewport: {
          width: 900,
          height: 507,
          dpr: 2,
          scrollX: 0,
          scrollY: 30,
          visualScale: 1,
          visualOffsetLeft: 0,
          visualOffsetTop: 0,
        },
      },
      window: { width: 900, height: 650, left: 20, top: 20 },
    },
    foreground: { tabId: 12, windowId: 1 },
    route: 'https://fixture.test/target',
    mode: 'EXTENDED',
    viewportSeconds: 30,
  };
}

export function prepared(): DisposableScanOwner {
  return { ...intent(), phase: 'PREPARED', scanTabId: 40, scanWindowId: 2 };
}

export function storage(initial?: DisposableScanOwner) {
  let stored = initial && structuredClone(initial);
  const writes: DisposableScanOwner[] = [];
  const load = vi.fn(async () => stored && structuredClone(stored));
  const persist = vi.fn(async (owner: DisposableScanOwner) => {
    writes.push(structuredClone(owner));
    stored = structuredClone(owner);
  });
  return {
    load,
    persist,
    writes,
    get stored() {
      return stored;
    },
    replace: (owner: DisposableScanOwner | undefined) => {
      stored = owner && structuredClone(owner);
    },
  };
}

export function closeFixture(owner = prepared()) {
  const state = storage(owner);
  let present = true;
  const events: string[] = [];
  const guard = vi.fn(async (current: DisposableScanOwner) => {
    events.push(`guard:${current.phase}`);
  });
  const locate = vi.fn(async (tabId: number) => {
    expect(tabId).toBe(40);
    return present ? { tabId: 40, windowId: 2 } : undefined;
  });
  const remove = vi.fn(async (tabId: number) => {
    expect(tabId).toBe(40);
    expect(state.stored?.phase).toBe('CLOSING');
    expect(events.at(-1)).toBe('guard:CLOSING');
    events.push('remove:40');
    present = false;
  });
  return {
    ...state,
    state,
    owner,
    guard,
    locate,
    remove,
    events,
    missing: () => {
      present = false;
    },
    run: () =>
      closeDisposableScan({
        owner,
        load: state.load,
        persist: state.persist,
        guard,
        locate,
        remove,
      }),
  };
}
