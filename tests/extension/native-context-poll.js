/** poll Native Context using actual browser state and retained fixture ownership. */
export async function pollNativeContext({
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
  getTabSwitchPromise,
  sleep,
  requestPoll,
}) {
  if (control.busy || control.finished) return;
  control.busy = true;
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
    if (summary !== control.progress) {
      control.progress = summary;
      await post('/progress', JSON.parse(summary));
    }
    if (!control.acted && job.state === 'RUNNING') {
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
          control.acted = true;
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
              value.finding.spatial?.visualField?.basis === 'W3C_CSS_REFERENCE',
          );
        if (event) {
          control.acted = true;
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
          event.kind === 'SEGMENT_BEGIN' && event.generation === job.generation,
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
      if (getTabSwitchPromise()) await getTabSwitchPromise();
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
              (key) => current.context?.viewport[key] === originalGeometry[key],
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
      control.finished = true;
    }
  } catch (error) {
    evidence.errors.push(String(error));
    await post('/progress', { fixtureError: String(error) }).catch(() => {});
    await post('/checkpoint', evidence).catch(() => {});
  } finally {
    timing.endedAt = Date.now();
    control.busy = false;
    if (pendingWakeups.size) requestPoll('COALESCED_DRAIN');
  }
}
