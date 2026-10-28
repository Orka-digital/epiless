/** perform Tab Switch Probe using actual browser state and retained fixture ownership. */
export async function performTabSwitchProbe({
  evidence,
  due,
  command,
  tabSwitchModule,
  snapshot,
  post,
}) {
  const cancellation = evidence.cancellation;
  const detach = evidence.events.find(
    (event) =>
      event.kind === 'DEBUGGER_DETACH_REPLY' &&
      event.requestId === due.requestId &&
      event.tabId === due.tabId &&
      event.at === due.detachedAt,
  );
  if (!detach || detach.at <= cancellation.stopRequestedAt)
    throw new Error('Tab-switch hypothesis has no matching real detach reply');
  const job = (await command({ type: 'GET_STATE' })).jobs.find(
    (value) => value.id === cancellation.jobId,
  );
  if (!job) throw new Error('Tab-switch hypothesis job unavailable');
  const plan = {
    jobId: job.id,
    generation: job.generation,
    before: cancellation.before,
    detach,
    due,
    blankUrl: `${chrome.runtime.getURL('fixture-placeholder.html')}#epiless-fixture-${crypto.randomUUID()}`,
  };
  const record = await tabSwitchModule.runTabSwitchProbe(plan, {
    now: () => Date.now(),
    read: async () => {
      const state = await command({ type: 'GET_STATE' });
      const current = state.jobs.find((value) => value.id === job.id);
      if (!current) throw new Error('Probe job disappeared');
      return snapshot(current);
    },
    remember: (value) =>
      chrome.storage.session.set({
        [`fixture-tab-switch:${job.id}`]: value,
      }),
    create: (options) => chrome.tabs.create(options),
    activate: (id) => chrome.tabs.update(id, { active: true }),
    remove: (id) => chrome.tabs.remove(id),
  });
  evidence.tabSwitchProbe = record;
  await post('/progress', {
    hypothesis: record.hypothesis,
    productionAcceptance: false,
    status: record.status,
    error: record.error,
    blankId: record.blankId,
    steps: record.steps.map(({ kind, at, repliedAt, label }) => ({
      kind,
      at,
      repliedAt,
      label,
    })),
  });
  if (record.status !== 'COMPLETED') evidence.errors.push(record.error);
}
