import { describe, expect, it, vi } from 'vitest';

import {
  createViewportWorkspace,
  restoreViewportWorkspace,
} from '../../apps/chrome-extension/src/viewport-workspace';
import { fixture } from './viewport-workspace.fixture';
describe('workspace creation and late cleanup interleavings', () => {
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
});
