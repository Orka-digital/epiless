// Isolated fixture page. It cannot start/resume a scan or request a stream ID.
// Actual toolbar authorization is required before either intervention runs.
(async () => {
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
  let busy = false,
    acted = false,
    finished = false,
    progress = '';
  let queued = false;
  const pendingWakeups = new Set();
  function requestPoll(reason) {
    if (finished) return;
    pendingWakeups.add(reason);
    if (busy || queued) {
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
    const page = await (await fetch(config.origin + '/original-page')).json();
    if (!page.tab || !page.geometry) return null;
    const tabId = evidence.ownedScan.originalInitial?.tab.id ?? page.tab.tabId;
    if (tabId !== page.tab.tabId)
      throw new Error('Original fixture identity changed');
    const tab = await chrome.tabs.get(tabId);
    const window = await chrome.windows.get(tab.windowId);
    let document = page.geometry;
    if (!initial) {
      // Read-only fixture identity, after the real UI has granted host access.
      // This never injects scanner code, changes the page or authorizes a scan.
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => ({
          at: Date.now(),
          documentId: globalThis.__nativeContextDocumentId,
          url: location.href,
          timeOrigin: performance.timeOrigin,
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
          outerWidth,
          outerHeight,
        }),
      });
      document = results[0]?.result;
      if (!document?.documentId)
        throw new Error('Original page document evidence unavailable');
    }
    const contextReply = await chrome.tabs
      .sendMessage(tabId, {
        type: 'FG_DIAGNOSTIC_CONTEXT',
      })
      .catch(() => null);
    return {
      at: Date.now(),
      tab: {
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        active: tab.active,
        url: tab.url,
        pinned: tab.pinned,
        groupId: tab.groupId,
      },
      window: {
        id: window.id,
        width: window.width,
        height: window.height,
        left: window.left,
        top: window.top,
        focused: window.focused,
      },
      foregroundTabId: (
        await chrome.tabs.query({ active: true, windowId: window.id })
      )[0]?.id,
      zoom: await chrome.tabs.getZoom(tabId),
      document,
      context: contextReply?.ok ? contextReply.value : null,
    };
  }
  async function ownedSnapshot(job) {
    const at = Date.now();
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((value) => value.id === job.tabId);
    const window = tab ? await chrome.windows.get(tab.windowId) : null;
    const session = await chrome.storage.session.get(null);
    const original = await originalSnapshot();
    const contextReply = tab
      ? await chrome.tabs
          .sendMessage(job.tabId, {
            type: 'FG_DIAGNOSTIC_CONTEXT',
          })
          .catch(() => null)
      : null;
    const debuggerTabIds = (await chrome.debugger.getTargets())
      .filter((value) => value.attached)
      .map((value) => value.tabId);
    return {
      at,
      jobId: job.id,
      generation: job.generation,
      jobState: job.state,
      pendingAction: job.tasks.find((task) => task.state === 'RUNNING')
        ?.pendingAction,
      tab: tab
        ? {
            id: tab.id,
            windowId: tab.windowId,
            index: tab.index,
            active: tab.active,
            url: tab.url,
          }
        : null,
      window: window
        ? {
            id: window.id,
            width: window.width,
            height: window.height,
            left: window.left,
            top: window.top,
            focused: window.focused,
          }
        : null,
      tabIds: tabs.map((value) => value.id),
      original,
      originalWindow: original?.window ?? null,
      foregroundTabId: original?.foregroundTabId,
      context: contextReply?.ok ? contextReply.value : null,
      workspace: session[`viewport-workspace:${job.id}`] ?? null,
      ownedScanOwner: session['advanced-scan-owner'] ?? null,
      ownershipKeys: Object.keys(session).filter(
        (key) =>
          key === 'advanced-scan-owner' ||
          key === `viewport-workspace:${job.id}` ||
          key === `viewport-workspace-intent:${job.id}` ||
          key === `viewport-rebind:${job.id}` ||
          key === `pointer-session:${job.tabId}`,
      ),
      windowIds: (await chrome.windows.getAll()).map((value) => value.id),
      debuggerAttached: debuggerTabIds.includes(job.tabId),
      debuggerTabIds,
      capturedTabs: (await chrome.tabCapture.getCapturedTabs()).map(
        ({ tabId, status, fullscreen }) => ({ tabId, status, fullscreen }),
      ),
      tracks: await tracks(),
    };
  }
  async function snapshot(job) {
    if (config.ownedScan) return ownedSnapshot(job);
    const at = Date.now();
    const tab = await chrome.tabs.get(job.tabId);
    const window = await chrome.windows.get(tab.windowId);
    const session = await chrome.storage.session.get(null);
    const workspace = session[`viewport-workspace:${job.id}`];
    const originalWindowId =
      workspace?.originalWindowId ??
      evidence.cancellation?.before.workspace.originalWindowId ??
      tab.windowId;
    const originalWindow = await chrome.windows
      .get(originalWindowId)
      .catch(() => null);
    const contextReply = await chrome.tabs
      .sendMessage(job.tabId, { type: 'FG_DIAGNOSTIC_CONTEXT' })
      .catch(() => null);
    return {
      at,
      jobId: job.id,
      generation: job.generation,
      jobState: job.state,
      pendingAction: job.tasks.find((task) => task.state === 'RUNNING')
        ?.pendingAction,
      tab: {
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        active: tab.active,
      },
      window: {
        id: window.id,
        width: window.width,
        height: window.height,
        left: window.left,
        top: window.top,
        focused: window.focused,
      },
      originalWindow: originalWindow && {
        id: originalWindow.id,
        width: originalWindow.width,
        height: originalWindow.height,
        left: originalWindow.left,
        top: originalWindow.top,
        focused: originalWindow.focused,
      },
      foregroundTabId: (
        await chrome.tabs.query({ active: true, windowId: originalWindowId })
      )[0]?.id,
      zoom: await chrome.tabs.getZoom(job.tabId),
      context: contextReply?.ok ? contextReply.value : null,
      workspace: workspace ?? null,
      ...(config.tabSwitchProbe && workspace
        ? {
            workspaceTabs: (
              await chrome.tabs.query({ windowId: workspace.windowId })
            ).map(
              ({
                id,
                windowId,
                active,
                url,
                pendingUrl,
                pinned,
                groupId,
                openerTabId,
              }) => ({
                id,
                windowId,
                active,
                url,
                pendingUrl,
                pinned,
                groupId,
                openerTabId,
              }),
            ),
          }
        : {}),
      ownershipKeys: Object.keys(session).filter(
        (key) =>
          key === `viewport-workspace:${job.id}` ||
          key === `viewport-workspace-intent:${job.id}` ||
          key === `viewport-rebind:${job.id}` ||
          key === `pointer-session:${job.tabId}`,
      ),
      windowIds: (await chrome.windows.getAll()).map((value) => value.id),
      debuggerAttached:
        (await chrome.debugger.getTargets()).find(
          (value) => value.tabId === job.tabId,
        )?.attached ?? false,
      capturedTabs: (await chrome.tabCapture.getCapturedTabs()).map(
        ({ tabId, status, fullscreen }) => ({ tabId, status, fullscreen }),
      ),
      tracks: await tracks(),
    };
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
    const record = (evidence.roundTrip = {
      jobId: job.id,
      segmentId: event.segmentId,
      candidateId: event.finding.id,
      startedAt: Date.now(),
    });
    record.before = await snapshot(job);
    if (record.before.zoom !== 1)
      throw new Error('Fixture requires initial page zoom 1');
    const original = record.before.window;
    if (
      config.mode === 'resize' &&
      (!record.before.workspace ||
        !record.before.tab.active ||
        original.focused ||
        record.before.tab.windowId !== record.before.workspace.windowId ||
        record.before.context?.viewport.width !== 600 ||
        original.width + 80 > record.before.originalWindow.width)
    )
      throw new Error(
        'Resize requires the actual compact tab in its unfocused owned workspace, within the original window cover',
      );
    try {
      if (config.mode === 'zoom') await chrome.tabs.setZoom(job.tabId, 1.1);
      else
        await chrome.windows.update(original.id, {
          width: original.width + 80,
        });
      record.changed = await until(
        () => snapshot(job),
        (value) =>
          config.mode === 'zoom'
            ? Math.abs(value.zoom - 1.1) < 1e-6 &&
              value.context?.viewport.dpr !==
                record.before.context?.viewport.dpr
            : value.context?.viewport.width !==
              record.before.context?.viewport.width,
      );
      await sleep(200);
    } catch (error) {
      record.changeFailure = {
        at: Date.now(),
        reason: String(error),
        lastObserved: error.lastObserved,
      };
      throw error;
    } finally {
      if (config.mode === 'zoom')
        await chrome.tabs.setZoom(job.tabId, record.before.zoom);
      else
        await chrome.windows.update(original.id, {
          width: original.width,
          height: original.height,
          left: original.left,
          top: original.top,
        });
      record.after = await until(
        () => snapshot(job),
        (value) =>
          value.zoom === record.before.zoom &&
          ['width', 'height', 'dpr'].every(
            (key) =>
              value.context?.viewport[key] ===
              record.before.context?.viewport[key],
          ),
      ).catch((error) => {
        record.restorationFailure = {
          at: Date.now(),
          reason: String(error),
          lastObserved: error.lastObserved,
        };
        throw error;
      });
      record.restoredAt = Date.now();
    }
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
    const cancellation = evidence.cancellation;
    const detach = evidence.events.find(
      (event) =>
        event.kind === 'DEBUGGER_DETACH_REPLY' &&
        event.requestId === due.requestId &&
        event.tabId === due.tabId &&
        event.at === due.detachedAt,
    );
    if (!detach || detach.at <= cancellation.stopRequestedAt)
      throw new Error(
        'Tab-switch hypothesis has no matching real detach reply',
      );
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
  const poll = async () => {
    if (busy || finished) return;
    busy = true;
    const timing = { startedAt: Date.now(), wakeups: [...pendingWakeups] };
    pendingWakeups.clear();
    evidence.polling.calls++;
    if (evidence.polling.samples.length < 500)
      evidence.polling.samples.push(timing);
    try {
      if (config.ownedScan && !evidence.ownedScan.originalInitial) {
        const initial = await originalSnapshot(true);
        if (
          !initial ||
          initial.document.width !== 900 ||
          initial.document.height !== 507 ||
          Date.now() - initial.document.at > 1500
        )
          return;
        const session = await chrome.storage.session.get(null);
        if (session['advanced-scan-owner'])
          throw new Error('Original snapshot must precede real UI preparation');
        evidence.ownedScan.originalInitial = initial;
        await post('/progress', {
          originalSnapshotReady: true,
          originalTabId: initial.tab.id,
          documentId: initial.document.documentId,
          geometry: {
            width: initial.document.width,
            height: initial.document.height,
            dpr: initial.document.dpr,
          },
        });
      }
      if (config.ownedScan && !evidence.ownedScan.preparation) {
        const session = await chrome.storage.session.get('advanced-scan-owner');
        const owner = session['advanced-scan-owner'];
        if (owner?.phase === 'PREPARED') {
          evidence.ownedScan.preparation = {
            at: Date.now(),
            owner,
            original: await originalSnapshot(),
            capturedTabs: await chrome.tabCapture.getCapturedTabs(),
            debuggerTabIds: (await chrome.debugger.getTargets())
              .filter((value) => value.attached)
              .map((value) => value.tabId),
          };
          await post('/progress', {
            ownedPreparationObserved: true,
            scanTabId: owner.scanTabId,
            originalTabId: owner.source?.tabId,
          });
        }
      }
      const state = await command({ type: 'GET_STATE' });
      const job = state.jobs.find((value) => value.origin === config.origin);
      if (!job) return;
      if (config.ownedScan && !evidence.ownedScan.beforeRun) {
        const current = await snapshot(job);
        evidence.ownedScan.beforeRun = current;
      }
      const pendingAction = job.tasks.find(
        (value) => value.state === 'RUNNING',
      )?.pendingAction;
      timing.state = job.state;
      timing.pendingAction = pendingAction;
      const summary = JSON.stringify({
        id: job.id,
        state: job.state,
        pendingAction,
      });
      if (summary !== progress) {
        progress = summary;
        await post('/progress', JSON.parse(summary));
      }
      if (!acted && job.state === 'RUNNING') {
        if (config.mode === 'cancel' && pendingAction === 'compact-viewport') {
          const begin = evidence.events.findLast(
            (event) =>
              event.kind === 'SEGMENT_BEGIN' &&
              event.generation === job.generation,
          );
          const ended = evidence.events.some(
            (event) =>
              event.kind === 'SEGMENT_END' &&
              event.segmentId === begin?.segmentId &&
              event.at >= begin.at,
          );
          const frame =
            !ended &&
            evidence.events.findLast(
              (event) =>
                event.kind === 'FRAME_DONE' &&
                event.segmentId === begin?.segmentId &&
                event.at >= begin.at &&
                event.frames >= 30,
            );
          if (frame) {
            acted = true;
            await cancel(job, frame);
          }
        } else if (
          (config.mode === 'zoom' && pendingAction?.startsWith('accordion-')) ||
          (config.mode === 'resize' && pendingAction === 'compact-accordion')
        ) {
          const begin = evidence.events.findLast(
            (value) =>
              value.kind === 'SEGMENT_BEGIN' &&
              value.generation === job.generation,
          );
          const ended = evidence.events.some(
            (value) =>
              value.kind === 'SEGMENT_END' &&
              value.segmentId === begin?.segmentId &&
              value.at >= begin.at,
          );
          const event =
            !ended &&
            evidence.events.findLast(
              (value) =>
                value.kind === 'WORKER_CANDIDATE' &&
                value.generation === job.generation &&
                value.segmentId === begin?.segmentId &&
                value.finding.spatial?.visualField?.basis ===
                  'W3C_CSS_REFERENCE',
            );
          if (event) {
            acted = true;
            await roundTrip(job, event);
          }
        }
      }
      if (
        config.ownedScan &&
        config.mode === 'complete' &&
        job.state === 'RUNNING' &&
        pendingAction === 'compact-viewport' &&
        !evidence.ownedScan.compactBefore
      ) {
        const begin = evidence.events.findLast(
          (event) =>
            event.kind === 'SEGMENT_BEGIN' &&
            event.generation === job.generation,
        );
        const frame = evidence.events.findLast(
          (event) =>
            event.kind === 'FRAME_DONE' &&
            event.segmentId === begin?.segmentId &&
            event.generation === job.generation &&
            event.frames >= 30,
        );
        const ended = evidence.events.some(
          (event) =>
            event.kind === 'SEGMENT_END' &&
            event.segmentId === begin?.segmentId &&
            event.at >= begin.at,
        );
        if (frame && !ended)
          evidence.ownedScan.compactBefore = {
            frame,
            snapshot: await snapshot(job),
          };
      }
      if (terminal.has(job.state)) {
        if (tabSwitchPromise) await tabSwitchPromise;
        // Production cleanup may still be finishing; retain every state tested.
        const originalGeometry = await (
          await fetch(
            config.origin +
              '/geometry-before-start?at=' +
              Date.parse(job.startedAt),
          )
        ).json();
        const cleanup = [];
        for (let i = 0; i < 15; i++) {
          const current = await snapshot(job);
          cleanup.push(current);
          const tracksReleased =
            current.tracks.context === 'CLOSED' ||
            (current.tracks.context === 'OPEN' &&
              current.tracks.streams.length > 0 &&
              current.tracks.streams.every(
                (stream) =>
                  !stream.active &&
                  stream.tracks.length > 0 &&
                  stream.tracks.every((track) => track.readyState === 'ended'),
              ));
          const geometryRestored = config.ownedScan
            ? current.tab === null &&
              current.original &&
              ['width', 'height', 'dpr'].every(
                (key) =>
                  current.original.document[key] ===
                  evidence.ownedScan.originalInitial.document[key],
              )
            : originalGeometry &&
              ['width', 'height', 'dpr'].every(
                (key) =>
                  current.context?.viewport[key] === originalGeometry[key],
              );
          if (
            !current.ownershipKeys.length &&
            !current.debuggerAttached &&
            !current.capturedTabs.some(
              (value) =>
                value.tabId === job.tabId &&
                ['active', 'pending'].includes(value.status),
            ) &&
            tracksReleased &&
            geometryRestored
          )
            break;
          await sleep(200);
        }
        evidence.cleanup = cleanup;
        if (config.ownedScan) evidence.ownedScan.after = cleanup.at(-1);
        if (evidence.cancellation) evidence.cancellation.after = cleanup.at(-1);
        evidence.job = (await command({ type: 'GET_STATE' })).jobs.find(
          (value) => value.id === job.id,
        );
        evidence.report = await command({ type: 'EXPORT', id: job.id });
        evidence.actualPermissions = await chrome.permissions.getAll();
        evidence.userAgent = navigator.userAgent;
        evidence.completedAt = Date.now();
        await post('/terminal', evidence);
        finished = true;
      }
    } catch (error) {
      evidence.errors.push(String(error));
      await post('/progress', { fixtureError: String(error) }).catch(() => {});
      await post('/checkpoint', evidence).catch(() => {});
    } finally {
      timing.endedAt = Date.now();
      busy = false;
      if (pendingWakeups.size) requestPoll('COALESCED_DRAIN');
    }
  };
  setInterval(() => requestPoll('INTERVAL'), 200);
  requestPoll('READY');
  await post('/progress', {
    collectorReady: true,
    mode: config.mode,
    authority: 'Actual toolbar start required',
  });
})();
