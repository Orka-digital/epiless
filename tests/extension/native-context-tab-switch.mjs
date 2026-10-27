// Fixture-only hypothesis. No capture grant, debugger command, focus, resize or
// production state mutation. A native PASS here is not production acceptance.
export const TAB_SWITCH_HYPOTHESIS = 'POST_DETACH_INFOBAR_CONTAINER_REBIND';
export const TAB_SWITCH_DELAY_MS = 5200;
export const TAB_SWITCH_DEADLINE_MS = 6700;

const reject = (reason) => {
  throw new Error(`TAB_SWITCH_PROBE_${reason}`);
};
const sameBounds = (a, b) =>
  ['width', 'height', 'left', 'top'].every((key) => a?.[key] === b?.[key]);

export function assertTabSwitchContext(
  value,
  plan,
  phase,
  blankId,
  now,
  allowPendingNavigation = false,
) {
  const { before, jobId, generation, detach } = plan;
  const workspace = before.workspace;
  if (
    now < detach.at + TAB_SWITCH_DELAY_MS ||
    now >= detach.at + TAB_SWITCH_DEADLINE_MS
  )
    reject('OUTSIDE_TERMINAL_WINDOW');
  if (
    value.jobId !== jobId ||
    value.generation !== generation ||
    value.jobState !== 'STOPPING' ||
    value.tab.id !== workspace.tabId ||
    value.tab.windowId !== workspace.windowId ||
    value.window.id !== workspace.windowId ||
    value.window.focused ||
    !value.originalWindow?.focused ||
    value.originalWindow.id !== workspace.originalWindowId ||
    !sameBounds(value.originalWindow, workspace.originalWindow) ||
    !sameBounds(value.window, workspace.originalWindow) ||
    value.foregroundTabId !== before.foregroundTabId ||
    JSON.stringify(value.workspace) !== JSON.stringify(workspace) ||
    !value.ownershipKeys.includes(`viewport-workspace:${jobId}`) ||
    value.ownershipKeys.includes(`pointer-session:${workspace.tabId}`) ||
    value.debuggerAttached ||
    value.context?.documentToken !== before.context.documentToken ||
    value.context?.url !== before.context.url
  )
    reject('OWNERSHIP_OR_CONTEXT_CHANGED');
  if (
    value.capturedTabs.some((tab) => ['active', 'pending'].includes(tab.status))
  )
    reject('PRODUCER_NOT_RELEASED');
  if (!(
    value.tracks.context === 'CLOSED' ||
    (value.tracks.context === 'OPEN' &&
      value.tracks.streams.length > 0 &&
      value.tracks.streams.every(
        (stream) =>
          !stream.active &&
          stream.tracks.length > 0 &&
          stream.tracks.every((track) => track.readyState === 'ended'),
      ))
  ))
    reject('TRACK_RELEASE_UNCONFIRMED');
  const expectedIds =
    blankId === undefined ? [workspace.tabId] : [workspace.tabId, blankId];
  if (
    value.workspaceTabs.length !== expectedIds.length ||
    !value.workspaceTabs.every((tab) => expectedIds.includes(tab.id))
  )
    reject('WORKSPACE_TABS_CHANGED');
  const activeId = phase === 'BLANK_ACTIVE' ? blankId : workspace.tabId;
  if (
    value.workspaceTabs.filter((tab) => tab.active).length !== 1 ||
    !value.workspaceTabs.some((tab) => tab.id === activeId && tab.active) ||
    value.tab.active !== (activeId === workspace.tabId)
  )
    reject('ACTIVE_TAB_CHANGED');
  if (blankId !== undefined) {
    const blank = value.workspaceTabs.find((tab) => tab.id === blankId);
    if (
      !blank ||
      blank.windowId !== workspace.windowId ||
      (blank.pendingUrl && blank.pendingUrl !== plan.blankUrl) ||
      blank.pinned ||
      blank.groupId !== -1 ||
      blank.openerTabId !== workspace.tabId
    )
      reject('OWNED_BLANK_CHANGED');
    if (blank.url !== plan.blankUrl) {
      // Pending own-extension navigation permits another read only. Browser
      // mutations still require the committed exact nonce URL below.
      if (
        allowPendingNavigation &&
        blank.url === undefined &&
        blank.pendingUrl === plan.blankUrl
      )
        return false;
      reject('OWNED_BLANK_CHANGED');
    }
  }
  return true;
}

export async function runTabSwitchProbe(plan, driver) {
  const record = {
    hypothesis: TAB_SWITCH_HYPOTHESIS,
    productionAcceptance: false,
    plan,
    status: 'RUNNING',
    steps: [],
  };
  let blankId;
  async function bounded(action) {
    const remaining = plan.detach.at + TAB_SWITCH_DEADLINE_MS - driver.now();
    if (remaining <= 0) reject('OUTSIDE_TERMINAL_WINDOW');
    let timer;
    try {
      return await Promise.race([
        action(),
        new Promise((_, fail) => {
          timer = setTimeout(
            () => fail(new Error('TAB_SWITCH_PROBE_REQUEST_TIMEOUT')),
            remaining,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function check(label, phase, expectedBlank = blankId) {
    const startedAt = driver.now();
    const step = { kind: 'CONTEXT', label, startedAt };
    record.steps.push(step);
    for (let attempt = 0; attempt < 50; attempt++) {
      step.state = await bounded(() => driver.read());
      step.at = driver.now();
      const ready = assertTabSwitchContext(
        step.state,
        plan,
        phase,
        expectedBlank ?? undefined,
        step.at,
        label === 'after-create',
      );
      if (ready) return;
      (step.pendingNavigation ??= []).push({ at: step.at, state: step.state });
      await bounded(() => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    reject('OWNED_BLANK_NAVIGATION_UNCONFIRMED');
  }
  async function mutation(kind, action, targetTabId) {
    const step = {
      kind,
      at: driver.now(),
      ...(targetTabId === undefined ? {} : { targetTabId }),
    };
    if (step.at >= plan.detach.at + TAB_SWITCH_DEADLINE_MS)
      reject('OUTSIDE_TERMINAL_WINDOW');
    record.steps.push(step);
    const result = await bounded(action);
    step.repliedAt = driver.now();
    if (result !== undefined) step.result = result;
    return result;
  }
  try {
    await check('before-intent', 'SOURCE_ACTIVE');
    // Persist before create. A create->receipt crash never authorizes guessed
    // tab removal; the isolated profile and retained intent make it reviewable.
    await bounded(() => driver.remember({ status: 'CREATE_INTENT', plan }));
    await check('before-create', 'SOURCE_ACTIVE');
    const blank = await mutation('CREATE_INACTIVE_BLANK', () =>
      driver.create({
        windowId: plan.before.workspace.windowId,
        openerTabId: plan.before.workspace.tabId,
        url: plan.blankUrl,
        active: false,
      }),
    );
    if (
      !Number.isSafeInteger(blank?.id) ||
      blank.id === plan.before.workspace.tabId
    )
      reject('CREATED_TAB_ID_UNAVAILABLE');
    blankId = blank.id;
    record.blankId = blankId;
    await bounded(() =>
      driver.remember({ status: 'OWNED_BLANK', plan, blankId }),
    );
    await check('after-create', 'SOURCE_ACTIVE');
    await check('before-activate-blank', 'SOURCE_ACTIVE');
    await mutation('ACTIVATE_BLANK', () => driver.activate(blankId), blankId);
    await check('after-activate-blank', 'BLANK_ACTIVE');
    await check('before-activate-source', 'BLANK_ACTIVE');
    await mutation(
      'ACTIVATE_SOURCE',
      () => driver.activate(plan.before.workspace.tabId),
      plan.before.workspace.tabId,
    );
    await check('after-activate-source', 'SOURCE_ACTIVE');
    await check('before-remove-blank', 'SOURCE_ACTIVE');
    await mutation('REMOVE_OWNED_BLANK', () => driver.remove(blankId), blankId);
    await check('after-remove-blank', 'SOURCE_ACTIVE', null);
    record.status = 'COMPLETED';
  } catch (error) {
    record.status = 'ABORTED';
    record.error = String(error);
    // Do not rescue after a context/deadline change. Even a known fixture tab
    // may now be user-owned or somewhere else. Retain its identity for review.
    if (blankId !== undefined) record.possibleRemainingBlankId = blankId;
  }
  record.endedAt = driver.now();
  // Evidence persistence cannot authorize another browser action. Do not keep
  // the terminal collector blocked indefinitely if session storage hangs.
  void driver.remember(record).catch(() => {});
  return record;
}
