import { describe, expect, it, vi } from 'vitest';

import {
  createDisposableScan,
  validOwnedStart,
  type DisposableScanOwner,
} from '../../apps/chrome-extension/src/disposable-scan';
import { intent, storage } from './disposable-scan.fixture';
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
});
