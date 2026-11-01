import { expect, vi } from 'vitest';

import {
  type ViewportWorkspace,
  type WorkspaceDriver,
} from '../../apps/chrome-extension/src/viewport-workspace';

export function fixture() {
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
