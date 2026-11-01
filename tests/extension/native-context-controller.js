import { readOriginalSnapshot } from './native-context-original.js';
import { readOwnedSnapshot } from './native-context-owned.js';
import { pollNativeContext } from './native-context-poll.js';
import { performTabSwitchProbe } from './native-context-probe.js';
import { performContextRoundTrip } from './native-context-roundtrip.js';
import { readContextSnapshot } from './native-context-snapshot.js';
// Isolated fixture page. It cannot start/resume a scan or request a stream ID.
// Actual toolbar authorization is required before either intervention runs.
export const controllerReady = (async () => {
  const config = await (await fetch('fixture-context-config.json')).json();
  const tabSwitchModule = config.tabSwitchProbe
    ? await import('./fixture-tab-switch.mjs')
    : null;
  const evidence = {
    schemaVersion: 1,
    mode: config.mode,
    events: [],
    zoomEvents: [],
    errors: [],
    polling: { calls: 0, coalescedWakeups: 0, samples: [] },
    ...(config.ownedScan ? { ownedScan: { version: 1 } } : {}),
    ...(config.tabSwitchProbe
      ? {
          hypothesis: 'POST_DETACH_INFOBAR_CONTAINER_REBIND',
          productionAcceptance: false,
        }
      : {}),
  };
  let tabSwitchPromise;
  let tabSwitchAttempted = false;
  const terminal = new Set(['COMPLETED', 'PARTIAL', 'INTERRUPTED', 'ERROR']);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const control = { busy: false, acted: false, finished: false, progress: '' };
  let queued = false;
  const pendingWakeups = new Set();
  function requestPoll(reason) {
    if (control.finished) return;
    pendingWakeups.add(reason);
    if (control.busy || queued) {
      evidence.polling.coalescedWakeups++;
      return;
    }
    queued = true;
    // A real worker/runtime event can wake a hidden extension page whose
    // interval is throttled. Coalesce events; never run concurrent mutations.
    queueMicrotask(() => {
      queued = false;
      void poll();
    });
  }
  const post = (route, value) =>
    fetch(config.origin + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      sender.id !== chrome.runtime.id ||
      message?.type !== 'FIXTURE_CONTEXT_EVIDENCE'
    )
      return;
    if (evidence.events.length < 1500) evidence.events.push(message.event);
    else if (!evidence.errors.includes('EVENT_BOUND_EXCEEDED'))
      evidence.errors.push('EVENT_BOUND_EXCEEDED');
    if (
      config.tabSwitchProbe &&
      message.event.kind === 'TAB_SWITCH_PROBE_DUE' &&
      !tabSwitchAttempted &&
      evidence.cancellation &&
      message.event.tabId === evidence.cancellation.before.tab.id
    ) {
      tabSwitchAttempted = true;
      tabSwitchPromise = tabSwitchProbe(message.event).catch((error) => {
        evidence.errors.push(String(error));
      });
    }
    if (
      [
        'FRAME_DONE',
        'WORKER_CANDIDATE',
        'SEGMENT_BEGIN',
        'SEGMENT_END',
        'CAPTURE_STOP_REQUEST',
      ].includes(message.event.kind)
    )
      requestPoll(message.event.kind);
  });
  chrome.tabs.onZoomChange.addListener((event) => {
    if (evidence.zoomEvents.length < 40)
      evidence.zoomEvents.push({ at: Date.now(), ...event });
  });
  async function command(message) {
    if (!['GET_STATE', 'EXPORT', 'STOP'].includes(message.type))
      throw new Error('Fixture command forbidden');
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw new Error(reply?.error ?? 'Missing command reply');
    return reply.value;
  }
  async function tracks() {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (!contexts.length) return { context: 'CLOSED', at: Date.now() };
    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: 'fixture-context-tracks' });
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        port.disconnect();
        resolve(value);
      };
      const timer = setTimeout(
        () => finish({ context: 'UNRESPONSIVE', at: Date.now() }),
        750,
      );
      port.onMessage.addListener((value) =>
        finish({ context: 'OPEN', ...value }),
      );
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
      });
      port.postMessage({ read: true });
    });
  }
  async function originalSnapshot(initial = false) {
    return readOriginalSnapshot({ config, evidence, initial });
  }
  async function ownedSnapshot(job) {
    return readOwnedSnapshot({ job, originalSnapshot, tracks });
  }
  async function snapshot(job) {
    return readContextSnapshot({
      config,
      ownedSnapshot,
      job,
      evidence,
      tracks,
    });
  }
  async function until(read, predicate, timeout = 1500) {
    const start = Date.now();
    let value;
    do {
      value = await read();
      if (predicate(value)) return value;
      await sleep(40);
    } while (Date.now() - start < timeout);
    const error = new Error(
      'Actual browser state did not reach requested condition',
    );
    error.lastObserved = value;
    throw error;
  }
  async function roundTrip(job, event) {
    return performContextRoundTrip({
      evidence,
      job,
      event,
      snapshot,
      config,
      until,
      sleep,
    });
  }
  async function cancel(job, frame) {
    evidence.cancellation = {
      jobId: job.id,
      segmentId: frame.segmentId,
      scenario: 'compact-viewport',
      acceptedFrame: frame,
    };
    const record = evidence.cancellation;
    record.before = await snapshot(job);
    if (
      !record.before.workspace ||
      !record.before.capturedTabs.some(
        (value) => value.tabId === job.tabId && value.status === 'active',
      ) ||
      !record.before.tracks.streams?.some(
        (stream) =>
          stream.active &&
          stream.tracks.some((track) => track.readyState === 'live'),
      )
    )
      throw new Error(
        'Actual compact workspace and active producer not demonstrated; STOP not sent',
      );
    record.stopRequestedAt = Date.now();
    record.stopReply = await command({ type: 'STOP', id: job.id });
  }
  async function tabSwitchProbe(due) {
    return performTabSwitchProbe({
      evidence,
      due,
      command,
      tabSwitchModule,
      snapshot,
      post,
    });
  }
  const poll = async () => {
    return pollNativeContext({
      control,
      pendingWakeups,
      evidence,
      config,
      originalSnapshot,
      post,
      command,
      snapshot,
      cancel,
      roundTrip,
      terminal,
      getTabSwitchPromise: () => tabSwitchPromise,
      sleep,
      requestPoll,
    });
  };
  setInterval(() => requestPoll('INTERVAL'), 200);
  requestPoll('READY');
  await post('/progress', {
    collectorReady: true,
    mode: config.mode,
    authority: 'Actual toolbar start required',
  });
})();
