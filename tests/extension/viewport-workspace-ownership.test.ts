import { describe, expect, it, vi } from 'vitest';

import {
  createViewportWorkspace,
  restoreViewportWorkspace,
} from '../../apps/chrome-extension/src/viewport-workspace';
import { fixture } from './viewport-workspace.fixture';
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
