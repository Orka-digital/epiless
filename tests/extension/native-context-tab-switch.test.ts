import { expect, it, vi } from 'vitest';
import { runTabSwitchProbe } from './native-context-tab-switch.mjs';

// Pure state-machine cases only. These do not generate native capture evidence.
function fixture() {
  let now = 6200;
  const workspace = {
    tabId: 1,
    windowId: 2,
    originalWindowId: 3,
    originalIndex: 2,
    originalWindow: { width: 900, height: 650, left: 20, top: 40 },
  };
  const context = {
    documentToken: 'same-document',
    url: 'http://127.0.0.1:1/',
    viewport: { width: 900, height: 450, dpr: 2 },
  };
  const before = { workspace, foregroundTabId: 4, context };
  const plan = {
    before,
    jobId: 'job',
    generation: 'generation',
    detach: { kind: 'DEBUGGER_DETACH_REPLY', at: 1000, requestId: 1, tabId: 1 },
    blankUrl:
      'chrome-extension://fixture/fixture-placeholder.html#unique-fixture',
  };
  const source = {
    id: 1,
    windowId: 2,
    active: true,
    url: context.url,
    pinned: false,
    groupId: -1,
  };
  const state: any = {
    jobId: 'job',
    generation: 'generation',
    jobState: 'STOPPING',
    tab: source,
    workspace,
    context,
    window: { id: 2, focused: false, ...workspace.originalWindow },
    originalWindow: { id: 3, focused: true, ...workspace.originalWindow },
    foregroundTabId: 4,
    ownershipKeys: ['viewport-workspace:job'],
    debuggerAttached: false,
    capturedTabs: [],
    tracks: {
      context: 'OPEN',
      streams: [{ active: false, tracks: [{ readyState: 'ended' }] }],
    },
    workspaceTabs: [source],
  };
  const mutations: string[] = [];
  const driver = {
    now: () => now++,
    read: vi.fn(async () => structuredClone(state)),
    remember: vi.fn(async (_value: any) => {}),
    create: vi.fn(async (options: any) => {
      mutations.push('create');
      const blank = { id: 5, ...options, pinned: false, groupId: -1 };
      state.workspaceTabs.push(blank);
      return structuredClone(blank);
    }),
    activate: vi.fn(async (id: number) => {
      mutations.push(`activate:${id}`);
      for (const tab of state.workspaceTabs) tab.active = tab.id === id;
    }),
    remove: vi.fn(async (id: number) => {
      mutations.push(`remove:${id}`);
      state.workspaceTabs = state.workspaceTabs.filter(
        (tab: any) => tab.id !== id,
      );
    }),
  };
  return {
    plan,
    state,
    driver,
    mutations,
    setTime: (time: number) => {
      now = time;
    },
  };
}

it('runs exactly one owned tab roundtrip with guards and retains its hypothesis label', async () => {
  const f = fixture();
  const result = await runTabSwitchProbe(f.plan, f.driver);
  expect(result.status).toBe('COMPLETED');
  expect(result.productionAcceptance).toBe(false);
  expect(f.mutations).toEqual([
    'create',
    'activate:5',
    'activate:1',
    'remove:5',
  ]);
  expect(f.driver.remember.mock.calls[0][0].status).toBe('CREATE_INTENT');
  expect(f.driver.read).toHaveBeenCalledTimes(9);
  expect(f.state.workspaceTabs.map((tab: any) => tab.id)).toEqual([1]);
});

it.each([
  [
    'focus takeover',
    (s: any) => {
      s.window.focused = true;
    },
  ],
  [
    'cover resize',
    (s: any) => {
      s.originalWindow.width = 1000;
    },
  ],
  [
    'new generation',
    (s: any) => {
      s.generation = 'replacement';
    },
  ],
  [
    'terminal job',
    (s: any) => {
      s.jobState = 'PARTIAL';
    },
  ],
  [
    'live producer',
    (s: any) => {
      s.capturedTabs.push({ tabId: 1, status: 'active' });
    },
  ],
  [
    'missing tracks',
    (s: any) => {
      s.tracks = { context: 'UNRESPONSIVE' };
    },
  ],
  [
    'debugger owner',
    (s: any) => {
      s.ownershipKeys.push('pointer-session:1');
    },
  ],
  [
    'another tab',
    (s: any) => {
      s.workspaceTabs.push({ id: 6 });
    },
  ],
])('aborts before mutation on %s', async (_name, alter) => {
  const f = fixture();
  alter(f.state);
  const result = await runTabSwitchProbe(f.plan, f.driver);
  expect(result.status).toBe('ABORTED');
  expect(f.mutations).toEqual([]);
});

it('does not reactivate or rescue after the user takes over the blank-tab interval', async () => {
  const f = fixture();
  const activate = f.driver.activate.getMockImplementation()!;
  f.driver.activate.mockImplementation(async (id) => {
    await activate(id);
    f.state.window.focused = true;
  });
  const result = await runTabSwitchProbe(f.plan, f.driver);
  expect(result.status).toBe('ABORTED');
  expect(result.possibleRemainingBlankId).toBe(5);
  expect(f.mutations).toEqual(['create', 'activate:5']);
});

it('never removes an owned blank that was navigated or moved', async () => {
  const f = fixture();
  const activate = f.driver.activate.getMockImplementation()!;
  f.driver.activate.mockImplementation(async (id) => {
    await activate(id);
    if (id === 1)
      f.state.workspaceTabs.find((tab: any) => tab.id === 5).url =
        'https://user.example/';
  });
  const result = await runTabSwitchProbe(f.plan, f.driver);
  expect(result.status).toBe('ABORTED');
  expect(f.driver.remove).not.toHaveBeenCalled();
});

it('a late create reply cannot trigger activation or post-deadline rescue', async () => {
  const f = fixture();
  const create = f.driver.create.getMockImplementation()!;
  f.driver.create.mockImplementation(async (options) => {
    const value = await create(options);
    f.setTime(7700);
    return value;
  });
  const result = await runTabSwitchProbe(f.plan, f.driver);
  expect(result.status).toBe('ABORTED');
  expect(result.error).toContain('OUTSIDE_TERMINAL_WINDOW');
  expect(f.mutations).toEqual(['create']);
});

it('a failed pre-create intent produces no browser mutation', async () => {
  const f = fixture();
  f.driver.remember.mockRejectedValueOnce(new Error('storage unavailable'));
  const result = await runTabSwitchProbe(f.plan, f.driver);
  expect(result.status).toBe('ABORTED');
  expect(f.mutations).toEqual([]);
});

it('waits read-only for the exact extension nonce URL to commit before activation', async () => {
  const f = fixture();
  const read = f.driver.read.getMockImplementation()!;
  let pendingReads = 0;
  f.driver.read.mockImplementation(async () => {
    const value = await read();
    const blank = value.workspaceTabs.find((tab: any) => tab.id === 5);
    if (blank && pendingReads++ === 0) {
      expect(f.mutations).toEqual(['create']);
      delete blank.url;
      blank.pendingUrl = f.plan.blankUrl;
    }
    return value;
  });
  const result = await runTabSwitchProbe(f.plan, f.driver);
  expect(result.status).toBe('COMPLETED');
  const committed = result.steps.find(
    (step: any) => step.label === 'after-create',
  );
  expect(committed.pendingNavigation).toHaveLength(1);
  expect(
    committed.state.workspaceTabs.find((tab: any) => tab.id === 5).url,
  ).toBe(f.plan.blankUrl);
  expect(f.mutations).toEqual([
    'create',
    'activate:5',
    'activate:1',
    'remove:5',
  ]);
});

it('retains the strict rejection when both actual URL fields are unavailable', async () => {
  const f = fixture();
  const create = f.driver.create.getMockImplementation()!;
  f.driver.create.mockImplementation(async (options) => {
    const created = await create(options);
    delete f.state.workspaceTabs.find((tab: any) => tab.id === 5).url;
    return created;
  });
  const result = await runTabSwitchProbe(f.plan, f.driver);
  expect(result.error).toContain('OWNED_BLANK_CHANGED');
  expect(f.mutations).toEqual(['create']);
});
