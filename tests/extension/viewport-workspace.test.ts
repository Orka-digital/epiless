import { describe, expect, it, vi } from 'vitest';
import {
  createViewportWorkspace,
  createDebuggerRestoreWorkspace,
  finalizeWorkspaceOwnership,
  restoreViewportWorkspace,
  type WorkspaceDriver,
  type ViewportWorkspace,
} from '../../apps/chrome-extension/src/viewport-workspace';

function fixture() {
  const viewport = { width: 900, height: 450, dpr: 2 };
  let geometry = { ...viewport };
  const original: chrome.windows.Window = {
    id: 1,
    type: 'normal',
    state: 'normal',
    focused: true,
    alwaysOnTop: false,
    incognito: false,
    width: 900,
    height: 650,
    left: 20,
    top: 20,
  };
  const windows = new Map<number, chrome.windows.Window>([[1, original]]);
  const target = {
    id: 11,
    windowId: 1,
    index: 2,
    active: false,
    pinned: false,
    groupId: -1,
  };
  let workspaceUserTabs = false;
  const driver: WorkspaceDriver = {
    tab: vi.fn(async () => ({ ...target })),
    window: vi.fn(async (id) => {
      const win = windows.get(id);
      if (!win) throw new Error('WINDOW_CLOSED');
      return { ...win };
    }),
    tabs: vi.fn(async (id) =>
      id === 1
        ? [{ id: 12, active: true }]
        : [
            ...(target.windowId === id
              ? [{ id: target.id, active: target.active }]
              : []),
            ...(workspaceUserTabs ? [{ id: 13, active: true }] : []),
          ],
    ),
    create: vi.fn(async (tabId, bounds) => {
      expect(tabId).toBe(11);
      target.windowId = 2;
      target.index = 0;
      target.active = true;
      const win = { ...original, ...bounds, id: 2, focused: false };
      windows.set(2, win);
      return win;
    }),
    resize: vi.fn(async (id, bounds) => {
      Object.assign(windows.get(id)!, bounds);
      geometry = { ...viewport };
    }),
    move: vi.fn(async (tabId, windowId, index) => {
      expect(tabId).toBe(11);
      target.windowId = windowId;
      target.index = index;
      target.active = false;
    }),
  };
  let lease: ViewportWorkspace | undefined;
  const options = {
    tabId: 11,
    driver,
    guard: vi.fn(async () => {}),
    read: vi.fn(async () => ({ ...geometry })),
    wait: vi.fn(async () => {}),
    rememberIntent: vi.fn(async () => {}),
    remember: vi.fn(async (value: ViewportWorkspace) => {
      lease = value;
    }),
  };
  return {
    driver,
    options,
    target,
    original,
    windows,
    get lease() {
      return lease!;
    },
    setGeometry: (v: typeof viewport) => {
      geometry = v;
    },
    addUserTab: () => {
      workspaceUserTabs = true;
    },
  };
}
describe('physical responsive workspace ownership', () => {
  it('uses a background window bounded by the original window and returns an inactive tab to its original index', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    expect(f.driver.create).toHaveBeenCalledWith(11, {
      width: 900,
      height: 650,
      left: 20,
      top: 20,
    });
    f.setGeometry({ width: 600, height: 450, dpr: 2 });
    await restoreViewportWorkspace({ workspace, ...f.options });
    expect(f.target).toMatchObject({ windowId: 1, index: 2, active: false });
    expect(f.driver.resize).toHaveBeenCalledWith(2, workspace.originalWindow);
    expect(f.original).toMatchObject({
      focused: true,
      width: 900,
      height: 650,
    });
  });
  it('records cleanup ownership before a cancellation after the tab moves', async () => {
    const f = fixture();
    f.options.guard.mockImplementation(async () => {
      if (f.target.windowId === 2) throw new Error('RUNNER_CANCELLED');
    });
    await expect(createViewportWorkspace(f.options)).rejects.toThrow(
      'RUNNER_CANCELLED',
    );
    expect(f.lease.windowId).toBe(2);
    // Restoration deliberately does not use the now-cancelled run guard.
    await restoreViewportWorkspace({ workspace: f.lease, ...f.options });
    expect(f.target.windowId).toBe(1);
  });
  it('retains user-added tabs and the window they occupy', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    f.addUserTab();
    await restoreViewportWorkspace({ workspace, ...f.options });
    expect(f.target.windowId).toBe(1);
  });
  it('does not move or close a tab the user relocated, or a workspace brought to the foreground', async () => {
    const moved = fixture();
    const first = await createViewportWorkspace(moved.options);
    vi.mocked(moved.driver.move).mockClear();
    moved.target.windowId = 3;
    await expect(
      restoreViewportWorkspace({ workspace: first, ...moved.options }),
    ).rejects.toThrow('VIEWPORT_WORKSPACE_TAB_MOVED');
    expect(moved.driver.move).not.toHaveBeenCalled();
    const focused = fixture();
    const second = await createViewportWorkspace(focused.options);
    vi.mocked(focused.driver.move).mockClear();
    vi.mocked(focused.driver.resize).mockClear();
    focused.windows.get(2)!.focused = true;
    await expect(
      restoreViewportWorkspace({ workspace: second, ...focused.options }),
    ).rejects.toThrow('VIEWPORT_WORKSPACE_BECAME_USER_WINDOW');
    expect(focused.driver.move).not.toHaveBeenCalled();
    expect(focused.driver.resize).not.toHaveBeenCalled();
  });
  it('retains the target safely when the original window was closed', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    vi.mocked(f.driver.move).mockClear();
    f.windows.delete(1);
    await expect(
      restoreViewportWorkspace({ workspace, ...f.options }),
    ).rejects.toThrow('WINDOW_CLOSED');
    expect(f.target.windowId).toBe(2);
    expect(f.driver.move).not.toHaveBeenCalled();
  });
  it('does not overwrite changed original window geometry, but returns the tab without activating it', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    vi.mocked(f.driver.resize).mockClear();
    f.original.width = 950;
    await expect(
      restoreViewportWorkspace({ workspace, ...f.options }),
    ).rejects.toThrow('VIEWPORT_WORKSPACE_COVER_CHANGED');
    expect(f.driver.resize).not.toHaveBeenCalled();
    expect(f.target).toMatchObject({ windowId: 1, active: false });
    expect(f.original.width).toBe(950);
  });
  it.each(['active', 'pinned', 'grouped', 'unfocused'] as const)(
    'rejects unsupported initial user context: %s',
    async (mode) => {
      const f = fixture();
      if (mode === 'grouped') f.target.groupId = 3;
      else if (mode === 'unfocused') f.original.focused = false;
      else f.target[mode] = true;
      await expect(createViewportWorkspace(f.options)).rejects.toThrow(
        'VIEWPORT_WORKSPACE_REQUIRES',
      );
      expect(f.driver.create).not.toHaveBeenCalled();
    },
  );
});

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
  it.each([false, true])(
    'retains exact-height failure and the %s terminal-detach budget',
    async (terminal) => {
      const f = fixture();
      const workspace = await createViewportWorkspace(f.options);
      workspace.detachedViewport = { width: 900, height: 507, dpr: 2 };
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'performance'],
      });
      try {
        f.options.read.mockResolvedValue({ width: 900, height: 449, dpr: 2 });
        f.options.wait.mockImplementation(async (ms?: number) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
        });
        const result = expect(
          restoreViewportWorkspace({
            workspace,
            ...f.options,
            ...(terminal ? { releaseDebugger: async () => {} } : {}),
          }),
        ).rejects.toThrow('VIEWPORT_RESTORE_GEOMETRY_UNCONFIRMED');
        await vi.advanceTimersByTimeAsync(terminal ? 6800 : 2800);
        expect(f.driver.move).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(300);
        await result;
        expect(f.target).toMatchObject({ windowId: 1, active: false });
        expect(f.driver.resize).toHaveBeenCalledTimes(1);
        expect(performance.now()).toBe(terminal ? 7100 : 3100);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it.each(['focus', 'moved', 'cover'] as const)(
    'aborts %s takeover during the extended terminal wait and only returns when still safe',
    async (change) => {
      const f = fixture();
      const workspace = await createViewportWorkspace(f.options);
      workspace.detachedViewport = { width: 900, height: 507, dpr: 2 };
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'performance'],
      });
      try {
        f.options.wait.mockImplementation(async (ms?: number) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
          if (performance.now() >= 4000) {
            if (change === 'focus') f.windows.get(2)!.focused = true;
            else if (change === 'moved') f.target.windowId = 3;
            else f.original.width = 950;
          }
        });
        const result = expect(
          restoreViewportWorkspace({
            workspace,
            ...f.options,
            releaseDebugger: async () => {},
          }),
        ).rejects.toThrow('VIEWPORT_WORKSPACE_');
        await vi.advanceTimersByTimeAsync(4100);
        await result;
        expect(f.driver.resize).toHaveBeenCalledTimes(1);
        if (change === 'cover') {
          expect(f.target).toMatchObject({ windowId: 1, active: false });
          expect(f.original.width).toBe(950);
        } else {
          expect(f.driver.move).not.toHaveBeenCalled();
          expect(f.target.windowId).toBe(change === 'focus' ? 2 : 3);
        }
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('keeps attached geometry between routes and never substitutes the detached expectation early', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    workspace.detachedViewport = { width: 900, height: 507, dpr: 2 };
    await restoreViewportWorkspace({ workspace, ...f.options });
    expect(await f.options.read()).toEqual(workspace.originalViewport);
  });
  it('does not invent a pre-attach baseline and still restores the owned outer bounds before reporting failure', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    f.setGeometry({ width: 600, height: 450, dpr: 2 });
    await expect(
      restoreViewportWorkspace({
        workspace,
        ...f.options,
        releaseDebugger: async () => {},
      }),
    ).rejects.toThrow('VIEWPORT_PRE_DEBUGGER_GEOMETRY_UNAVAILABLE');
    expect(f.driver.resize).toHaveBeenCalledWith(2, workspace.originalWindow);
    expect(f.target).toMatchObject({ windowId: 1, active: false });
  });
  it('preserves a failed debugger release and an actually stale CSS height as failures', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    workspace.detachedViewport = { width: 900, height: 507, dpr: 2 };
    await expect(
      restoreViewportWorkspace({
        workspace,
        ...f.options,
        releaseDebugger: async () => {
          throw new Error('DEBUGGER_RELEASE_UNCONFIRMED');
        },
      }),
    ).rejects.toThrow('DEBUGGER_RELEASE_UNCONFIRMED');
    expect(f.target).toMatchObject({ windowId: 1, active: false });
    const stale = fixture();
    const other = await createViewportWorkspace(stale.options);
    other.detachedViewport = { width: 900, height: 507, dpr: 2 };
    await expect(
      restoreViewportWorkspace({
        workspace: other,
        ...stale.options,
        releaseDebugger: async () => {},
      }),
    ).rejects.toThrow('VIEWPORT_RESTORE_GEOMETRY_UNCONFIRMED');
    expect(stale.target).toMatchObject({ windowId: 1, active: false });
  });
  it('respects a user focus change during debugger release without resizing or moving their tab', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    workspace.detachedViewport = { width: 900, height: 507, dpr: 2 };
    vi.mocked(f.driver.resize).mockClear();
    await expect(
      restoreViewportWorkspace({
        workspace,
        ...f.options,
        releaseDebugger: async () => {
          f.windows.get(2)!.focused = true;
        },
      }),
    ).rejects.toThrow('VIEWPORT_WORKSPACE_BECAME_USER_WINDOW');
    expect(f.driver.resize).not.toHaveBeenCalled();
    expect(f.driver.move).not.toHaveBeenCalled();
  });
  it('persists a non-authoritative intent before the direct move, and can cancel without moving', async () => {
    const f = fixture();
    f.options.rememberIntent.mockImplementation(async () => {
      expect(f.target.windowId).toBe(1);
      f.options.guard.mockRejectedValue(new Error('RUNNER_CANCELLED'));
    });
    await expect(createViewportWorkspace(f.options)).rejects.toThrow(
      'RUNNER_CANCELLED',
    );
    expect(f.driver.create).not.toHaveBeenCalled();
    expect(f.options.rememberIntent).toHaveBeenCalledWith({
      tabId: 11,
      originalWindowId: 1,
      originalIndex: 2,
    });
  });
  it('does not move a tab activated by the user during the initial DOM read', async () => {
    const f = fixture();
    f.options.read.mockImplementation(async () => {
      f.target.active = true;
      return { width: 900, height: 450, dpr: 2 };
    });
    await expect(createViewportWorkspace(f.options)).rejects.toThrow(
      'VIEWPORT_WORKSPACE_CONTEXT_CHANGED',
    );
    expect(f.driver.create).not.toHaveBeenCalled();
  });
  it('leaves a workspace alone when the user focuses it while restoration is settling', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    vi.mocked(f.driver.move).mockClear();
    f.options.wait.mockImplementation(async () => {
      f.windows.get(2)!.focused = true;
    });
    await expect(
      restoreViewportWorkspace({ workspace, ...f.options }),
    ).rejects.toThrow('VIEWPORT_WORKSPACE_BECAME_USER_WINDOW');
    expect(f.driver.move).not.toHaveBeenCalled();
    expect(f.target.windowId).toBe(2);
  });
});
