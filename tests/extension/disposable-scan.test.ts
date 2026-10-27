import { describe, expect, it, vi } from 'vitest';
import {
  ADVANCED_SCAN_OWNER_KEY,
  closeDisposableScan,
  createDisposableScan,
  matchingRecord,
  validOwnedStart,
  type DisposableScanOwner,
} from '../../apps/chrome-extension/src/disposable-scan';

function intent(): DisposableScanOwner {
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
function prepared(): DisposableScanOwner {
  return { ...intent(), phase: 'PREPARED', scanTabId: 40, scanWindowId: 2 };
}
function storage(initial?: DisposableScanOwner) {
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
function closeFixture(owner = prepared()) {
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

describe('disposable scan ownership records', () => {
  it('has one explicit storage key and compares all JSON fields independent of key insertion order', () => {
    expect(ADVANCED_SCAN_OWNER_KEY).toBe('advanced-scan-owner');
    const owner = { ...prepared(), extra: { a: 1, b: ['x', 'y'] } };
    const reordered = { extra: { b: ['x', 'y'], a: 1 }, ...prepared() };
    expect(JSON.stringify(owner)).not.toBe(JSON.stringify(reordered));
    expect(matchingRecord(owner, reordered)).toBe(true);
    reordered.extra.b.reverse();
    expect(matchingRecord(owner, reordered)).toBe(false);
    expect(matchingRecord(prepared(), { ...prepared(), extra: true })).toBe(
      false,
    );
    expect(matchingRecord({ x: NaN }, { x: NaN })).toBe(false);
    expect(matchingRecord({ x: Infinity }, { x: Infinity })).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(matchingRecord(cyclic, cyclic)).toBe(false);
  });

  it.each(['PREPARED', 'PAUSED'] as const)(
    'accepts the exact owned start in %s',
    (phase) => {
      const owner = { ...prepared(), phase };
      expect(
        validOwnedStart(owner, {
          tabId: 40,
          url: owner.route,
          mode: owner.mode,
          viewportSeconds: 30,
          nonce: owner.nonce,
        }),
      ).toBe(true);
    },
  );

  it.each(['CREATE_INTENT', 'RUNNING', 'CLOSING', 'MANUAL'] as const)(
    'does not start or resume from %s',
    (phase) => {
      const owner = { ...prepared(), phase };
      expect(
        validOwnedStart(owner, {
          tabId: 40,
          url: owner.route,
          mode: owner.mode,
          viewportSeconds: 30,
        }),
      ).toBe(false);
    },
  );

  it.each([
    { tabId: 11 },
    { url: 'https://fixture.test/another-route' },
    { url: 'https://foreign.test/target' },
    { mode: 'QUICK' as const },
    { viewportSeconds: 31 },
    { nonce: 'stale-attempt' },
    {
      replayOf: { jobId: 'old', taskId: 'task', observationId: 'observation' },
    },
  ])('rejects changed authorization %j', (change) => {
    const owner = prepared();
    expect(
      validOwnedStart(owner, {
        tabId: 40,
        url: owner.route,
        mode: owner.mode,
        viewportSeconds: 30,
        ...change,
      }),
    ).toBe(false);
  });

  it('requires the exact replay reference and a route on the original source origin', () => {
    const owner = prepared();
    owner.replayOf = {
      jobId: 'old',
      taskId: 'task',
      observationId: 'observation',
    };
    const start = {
      tabId: 40,
      url: owner.route,
      mode: owner.mode,
      viewportSeconds: 30,
      replayOf: { ...owner.replayOf },
    };
    expect(validOwnedStart(owner, start)).toBe(true);
    expect(validOwnedStart(owner, { ...start, replayOf: undefined })).toBe(
      false,
    );
    owner.source.url = 'https://another-origin.test/original';
    expect(validOwnedStart(owner, start)).toBe(false);
  });
});

describe('disposable scan creation', () => {
  it('persists the intent before creating and then records only the acknowledged new tab/window', async () => {
    const state = storage(),
      owner = intent();
    const original = structuredClone(owner);
    const create = vi.fn(async (current: DisposableScanOwner) => {
      expect(current).toEqual(original);
      expect(state.stored).toEqual(original);
      expect(state.writes.map((write) => write.phase)).toEqual([
        'CREATE_INTENT',
      ]);
      return { tabId: 40, windowId: 2 };
    });
    const result = await createDisposableScan({ owner, ...state, create });
    expect(result).toMatchObject({
      phase: 'PREPARED',
      scanTabId: 40,
      scanWindowId: 2,
    });
    expect(state.stored).toEqual(result);
    expect(state.writes.map((write) => write.phase)).toEqual([
      'CREATE_INTENT',
      'PREPARED',
    ]);
    expect(owner).toEqual(original);
  });

  it('does not create anything if the intent cannot be persisted', async () => {
    const state = storage(),
      create = vi.fn(async () => ({ tabId: 40, windowId: 2 }));
    state.persist.mockRejectedValue(new Error('STORAGE_UNAVAILABLE'));
    const result = await createDisposableScan({
      owner: intent(),
      ...state,
      create,
    });
    expect(result).toMatchObject({
      phase: 'MANUAL',
      reason: 'STORAGE_UNAVAILABLE',
    });
    expect(result.scanTabId).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a distinct owned scan tab in the same window as the unchanged source', async () => {
    const state = storage(),
      owner = intent();
    const result = await createDisposableScan({
      owner,
      ...state,
      create: async () => ({ tabId: 40, windowId: owner.source.windowId }),
    });
    expect(result).toMatchObject({
      phase: 'PREPARED',
      scanTabId: 40,
      scanWindowId: 1,
    });
    expect(result.source).toEqual(owner.source);
    expect(
      validOwnedStart(result, {
        tabId: 40,
        url: owner.route,
        mode: owner.mode,
        viewportSeconds: owner.viewportSeconds,
      }),
    ).toBe(true);
  });

  it('retains an unknown create failure as manual recovery without guessing a receipt', async () => {
    const state = storage();
    const create = vi.fn(async () => {
      throw new Error('CREATE_REPLY_LOST');
    });
    const result = await createDisposableScan({
      owner: intent(),
      ...state,
      create,
    });
    expect(result).toMatchObject({
      phase: 'MANUAL',
      reason: 'CREATE_REPLY_LOST',
    });
    expect(result.scanTabId).toBeUndefined();
    expect(result.scanWindowId).toBeUndefined();
    expect(state.stored).toEqual(result);
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'keeps the known local receipt when prepared persistence fails, including a manual-write failure=%s',
    async (manualFails) => {
      const state = storage();
      const persist = state.persist.getMockImplementation()!;
      state.persist.mockImplementation(async (owner) => {
        if (
          owner.phase === 'PREPARED' ||
          (manualFails && owner.phase === 'MANUAL')
        )
          throw new Error('RECEIPT_STORAGE_FAILED');
        await persist(owner);
      });
      const result = await createDisposableScan({
        owner: intent(),
        ...state,
        create: async () => ({ tabId: 40, windowId: 2 }),
      });
      expect(result).toMatchObject({
        phase: 'MANUAL',
        scanTabId: 40,
        scanWindowId: 2,
        reason: 'RECEIPT_STORAGE_FAILED',
      });
      expect(state.stored?.phase).toBe(
        manualFails ? 'CREATE_INTENT' : 'MANUAL',
      );
    },
  );

  it('retains a known tab ID when only the window receipt is missing', async () => {
    const state = storage();
    const result = await createDisposableScan({
      owner: intent(),
      ...state,
      create: async () => ({ tabId: 40, windowId: NaN }),
    });
    expect(result).toMatchObject({
      phase: 'MANUAL',
      scanTabId: 40,
      reason: 'DISPOSABLE_SCAN_CREATE_RECEIPT_UNKNOWN',
    });
    expect(result.scanWindowId).toBeUndefined();
  });

  it('does not overwrite another stored owner or create a replacement', async () => {
    const foreign = { ...intent(), nonce: 'newer-owner' },
      state = storage(foreign);
    const create = vi.fn(async () => ({ tabId: 40, windowId: 2 }));
    const result = await createDisposableScan({
      owner: intent(),
      ...state,
      create,
    });
    expect(result.phase).toBe('MANUAL');
    expect(state.stored).toEqual(foreign);
    expect(state.persist).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('checks the persisted intent again immediately before creation', async () => {
    const state = storage(),
      foreign = { ...intent(), nonce: 'newer-owner' };
    state.persist.mockImplementation(async () => {
      state.replace(foreign);
    });
    const create = vi.fn(async () => ({ tabId: 40, windowId: 2 }));
    await createDisposableScan({ owner: intent(), ...state, create });
    expect(create).not.toHaveBeenCalled();
    expect(state.stored).toEqual(foreign);
  });

  it.each(['replaced', 'cleared'] as const)(
    'keeps a receipt locally without restoring stale ownership when storage was %s during creation',
    async (change) => {
      const state = storage(),
        foreign = { ...intent(), nonce: 'newer-owner' };
      const result = await createDisposableScan({
        owner: intent(),
        ...state,
        create: async () => {
          state.replace(change === 'replaced' ? foreign : undefined);
          return { tabId: 40, windowId: 2 };
        },
      });
      expect(result).toMatchObject({
        phase: 'MANUAL',
        scanTabId: 40,
        scanWindowId: 2,
      });
      expect(state.stored).toEqual(change === 'replaced' ? foreign : undefined);
    },
  );
});

describe('disposable scan close', () => {
  it.each(['PREPARED', 'PAUSED', 'RUNNING'] as const)(
    'closes only the known %s scan after persistence and fresh guards',
    async (phase) => {
      const f = closeFixture({ ...prepared(), phase });
      expect(await f.run()).toBe(true);
      expect(f.remove).toHaveBeenCalledExactlyOnceWith(40);
      expect(f.state.stored).toMatchObject({
        phase: 'CLOSING',
        scanTabId: 40,
        scanWindowId: 2,
      });
      expect(
        f.guard.mock.calls.every(([owner]) => owner.nonce === f.owner.nonce),
      ).toBe(true);
      expect(f.locate).toHaveBeenCalledTimes(3);
    },
  );

  it('finalizes an authoritatively missing known tab without issuing a deletion', async () => {
    const f = closeFixture();
    f.missing();
    expect(await f.run()).toBe(true);
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.state.stored?.phase).toBe('CLOSING');
  });

  it('allows the separately verified cleanup window while retaining the original prepared window', async () => {
    const f = closeFixture({ ...prepared(), cleanupWindowId: 3 });
    let present = true;
    f.locate.mockImplementation(async () =>
      present ? { tabId: 40, windowId: 3 } : undefined,
    );
    f.remove.mockImplementation(async (tabId) => {
      expect(tabId).toBe(40);
      expect(f.events.at(-1)).toBe('guard:CLOSING');
      present = false;
    });
    expect(await f.run()).toBe(true);
    expect(f.state.stored).toMatchObject({
      phase: 'CLOSING',
      scanWindowId: 2,
      cleanupWindowId: 3,
    });
    expect(f.remove).toHaveBeenCalledExactlyOnceWith(40);
  });

  it('does not let a cleanup-window receipt authorize another window or bypass the caller guard', async () => {
    const moved = closeFixture({ ...prepared(), cleanupWindowId: 3 });
    moved.locate.mockResolvedValue({ tabId: 40, windowId: 99 });
    expect(await moved.run()).toBe(false);
    expect(moved.remove).not.toHaveBeenCalled();
    expect(moved.state.stored?.reason).toBe('DISPOSABLE_SCAN_TAB_MOVED');
    const guarded = closeFixture({ ...prepared(), cleanupWindowId: 3 });
    guarded.guard.mockRejectedValue(new Error('WORKSPACE_OWNERSHIP_CHANGED'));
    expect(await guarded.run()).toBe(false);
    expect(guarded.remove).not.toHaveBeenCalled();
  });

  it.each(['missing', 'source'] as const)(
    'never removes a %s receipt',
    async (kind) => {
      const owner = prepared();
      if (kind === 'missing') delete owner.scanTabId;
      else owner.scanTabId = owner.source.tabId;
      const f = closeFixture(owner);
      expect(await f.run()).toBe(false);
      expect(f.remove).not.toHaveBeenCalled();
      expect(f.locate).not.toHaveBeenCalled();
      expect(f.state.stored?.phase).toBe('MANUAL');
    },
  );

  it.each(['PREPARED', 'CLOSING'] as const)(
    'honors a failed original-context/resource guard in %s',
    async (phase) => {
      const f = closeFixture();
      f.guard.mockImplementation(async (owner) => {
        if (owner.phase === phase) throw new Error('ORIGINAL_CONTEXT_CHANGED');
      });
      expect(await f.run()).toBe(false);
      expect(f.remove).not.toHaveBeenCalled();
      expect(f.state.stored).toMatchObject({
        phase: 'MANUAL',
        reason: 'ORIGINAL_CONTEXT_CHANGED',
        scanTabId: 40,
      });
    },
  );

  it('refuses deletion after another owner replaces closing persistence', async () => {
    const f = closeFixture(),
      foreign = { ...prepared(), nonce: 'new-owner' };
    f.state.persist.mockImplementation(async () => {
      f.state.replace(foreign);
    });
    expect(await f.run()).toBe(false);
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.state.stored).toEqual(foreign);
  });

  it.each([
    'lookup failed',
    'moved',
    'remove failed',
    'still present',
  ] as const)('retains manual recovery when %s', async (failure) => {
    const f = closeFixture();
    if (failure === 'lookup failed')
      f.locate.mockRejectedValue(new Error('LOOKUP_FAILED'));
    if (failure === 'moved')
      f.locate.mockResolvedValue({ tabId: 40, windowId: 99 });
    if (failure === 'remove failed')
      f.remove.mockRejectedValue(new Error('REMOVE_FAILED'));
    if (failure === 'still present') f.remove.mockResolvedValue();
    expect(await f.run()).toBe(false);
    expect(f.state.stored).toMatchObject({
      phase: 'MANUAL',
      scanTabId: 40,
      scanWindowId: 2,
    });
    if (failure === 'lookup failed' || failure === 'moved')
      expect(f.remove).not.toHaveBeenCalled();
  });
});
