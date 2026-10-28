import { describe, expect, it } from 'vitest';

import { closeFixture, prepared } from './disposable-scan.fixture';
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
