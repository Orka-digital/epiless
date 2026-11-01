import { describe, expect, it, vi } from 'vitest';

import {
  createDebuggerRestoreWorkspace,
  createViewportWorkspace,
  finalizeWorkspaceOwnership,
  restoreViewportWorkspace,
} from '../../apps/chrome-extension/src/viewport-workspace';
import { fixture } from './viewport-workspace.fixture';
describe('workspace creation and late cleanup interleavings', () => {
  it.each(['user-focus', 'original-closed', 'query-unavailable'] as const)(
    'retains only a manual location intent after failed return: %s',
    async (failure) => {
      const f = fixture();
      const workspace = await createViewportWorkspace(f.options);
      if (failure === 'user-focus') f.windows.get(2)!.focused = true;
      if (failure === 'original-closed') f.windows.delete(1);
      if (failure !== 'query-unavailable')
        await expect(
          restoreViewportWorkspace({ workspace, ...f.options }),
        ).rejects.toThrow();
      const storage: Record<string, unknown> = { lease: workspace };
      const clear = vi.fn(async () => {
        delete storage.lease;
        delete storage.intent;
      });
      await finalizeWorkspaceOwnership({
        workspace,
        locate: async () => {
          if (failure === 'query-unavailable') throw new Error('QUERY_FAILED');
          return { windowId: f.target.windowId };
        },
        clear,
        downgrade: async (intent) => {
          Object.assign(storage, { lease: null, intent });
          delete storage.lease;
        },
      });
      expect(clear).not.toHaveBeenCalled();
      expect(storage).toEqual({
        intent: { tabId: 11, originalWindowId: 1, originalIndex: 2 },
      });
      expect(f.target.windowId).toBe(2);
    },
  );

  it('clears ownership only after an actual returned location or an explicit closed-tab result', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    for (const located of [{ windowId: 1 }, undefined]) {
      const clear = vi.fn(async () => {}),
        downgrade = vi.fn(async () => {});
      await finalizeWorkspaceOwnership({
        workspace,
        locate: async () => located,
        clear,
        downgrade,
      });
      expect(clear).toHaveBeenCalledOnce();
      expect(downgrade).not.toHaveBeenCalled();
    }
  });

  it('recreates a covered restore workspace after a stop races the previous between-route return', async () => {
    const f = fixture();
    const first = await createViewportWorkspace(f.options);
    await restoreViewportWorkspace({ workspace: first, ...f.options });
    const baseline = {
      viewport: { width: 900, height: 507, dpr: 2 },
      window: { id: 1, ...first.originalWindow },
    };
    const second = await createDebuggerRestoreWorkspace({
      ...f.options,
      baseline,
    });
    expect(f.target).toMatchObject({ windowId: 2, active: true });
    expect(f.windows.get(2)?.focused).toBe(false);
    expect(second.detachedViewport).toEqual(baseline.viewport);
    expect(f.lease.detachedViewport).toEqual(baseline.viewport);
    expect(f.driver.create).toHaveBeenCalledTimes(2);
  });

  it('refuses a changed user window and retains restoration ownership if a late race interrupts creation', async () => {
    const f = fixture();
    const baseline = {
      viewport: { width: 900, height: 507, dpr: 2 },
      window: { id: 1, width: 900, height: 650, left: 20, top: 20 },
    };
    f.original.width = 950;
    await expect(
      createDebuggerRestoreWorkspace({ ...f.options, baseline }),
    ).rejects.toThrow('DEBUGGER_RESTORE_WINDOW_CHANGED');
    expect(f.driver.create).not.toHaveBeenCalled();
    f.original.width = 900;
    f.options.guard.mockImplementation(async () => {
      if (f.target.windowId === 2) throw new Error('OWNERSHIP_CHANGED');
    });
    await expect(
      createDebuggerRestoreWorkspace({ ...f.options, baseline }),
    ).rejects.toThrow('OWNERSHIP_CHANGED');
    expect(f.lease.detachedViewport).toEqual(baseline.viewport);
    expect(f.lease.originalIndex).toBe(2);
    expect(f.target.windowId).toBe(2);
  });

  it('detaches in the owned active workspace and verifies the measured pre-debugger layout before inactive return', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    workspace.detachedViewport = { width: 900, height: 507, dpr: 2 };
    let detached = false;
    const resize = f.driver.resize;
    f.driver.resize = vi.fn(async (id, bounds) => {
      await resize(id, bounds);
      if (detached) f.setGeometry({ width: 900, height: 507, dpr: 2 });
    });
    const releaseDebugger = vi.fn(async () => {
      expect(f.target).toMatchObject({ windowId: 2, active: true });
      expect(f.windows.get(2)?.focused).toBe(false);
      expect(f.driver.move).not.toHaveBeenCalled();
      detached = true;
    });
    f.setGeometry({ width: 600, height: 450, dpr: 2 });
    // Serialized ownership from a worker restart uses the same measured contract.
    await restoreViewportWorkspace({
      workspace: structuredClone(workspace),
      ...f.options,
      releaseDebugger,
    });
    expect(releaseDebugger).toHaveBeenCalledOnce();
    expect(await f.options.read()).toEqual(workspace.detachedViewport);
    expect(f.target).toMatchObject({ windowId: 1, index: 2, active: false });
  });

  it('waits through the actual five-second debugger notice and its animation before returning the tab inactive', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    workspace.detachedViewport = { width: 900, height: 507, dpr: 2 };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      let releasedAt: number | undefined;
      f.options.read.mockImplementation(async () => {
        const elapsed = performance.now() - (releasedAt ?? 0);
        return {
          width: 900,
          height: elapsed < 5000 ? 450 : elapsed < 5200 ? 480 : 507,
          dpr: 2,
        };
      });
      f.options.wait.mockImplementation(async (ms?: number) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
      const releaseDebugger = vi.fn(async () => {
        releasedAt = performance.now();
      });
      const result = restoreViewportWorkspace({
        workspace,
        ...f.options,
        releaseDebugger,
      });
      await vi.advanceTimersByTimeAsync(5100);
      expect(f.target).toMatchObject({ windowId: 2, active: true });
      expect(f.driver.move).not.toHaveBeenCalled();
      expect(f.windows.get(2)?.focused).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      await result;
      expect(releaseDebugger).toHaveBeenCalledOnce();
      expect(f.driver.resize).toHaveBeenCalledTimes(1);
      expect(f.target).toMatchObject({ windowId: 1, index: 2, active: false });
      expect(f.original).toMatchObject({
        focused: true,
        width: 900,
        height: 650,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
