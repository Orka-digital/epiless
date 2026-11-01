/** perform Context Round Trip using actual browser state and retained fixture ownership. */
export async function performContextRoundTrip({
  evidence,
  job,
  event,
  snapshot,
  config,
  until,
  sleep,
}) {
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
            value.context?.viewport.dpr !== record.before.context?.viewport.dpr
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
