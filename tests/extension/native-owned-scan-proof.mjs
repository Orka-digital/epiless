import {
  assertOwnedOriginal,
  verifyOwnedPreparation,
} from './native-owned-preparation-proof.mjs';
// Pure evidence checker. Usage: node verify-native-context-guard.mjs evidence.json
// This does not generate evidence or start/attach a browser.
import assert from 'node:assert/strict';

import {
  hasActiveCapture,
  hasLiveTrack,
} from './native-context-proof-common.mjs';

export function verifyOwnedScan(evidence, common) {
  const { job, ownedScan: owned } = evidence;
  const { initial, prepared, owner } = verifyOwnedPreparation(evidence);
  const assertOriginal = (snapshot) =>
    assertOwnedOriginal(snapshot, initial, owner);
  assertOriginal(prepared.original);
  const cancellation = evidence.mode === 'cancel';
  const before = cancellation
    ? evidence.cancellation?.before
    : owned.compactBefore?.snapshot;
  const frame = cancellation
    ? evidence.cancellation?.acceptedFrame
    : owned.compactBefore?.frame;
  assert.ok(before && frame, 'A live compact observation is required.');
  assert.equal(before.jobId, job.id);
  assert.equal(before.generation, job.generation);
  assert.equal(before.jobState, 'RUNNING');
  assert.equal(before.pendingAction, 'compact-viewport');
  assertOriginal(before.original);
  assert.equal(before.original.tab.active, false);
  assert.equal(before.original.window.focused, true);
  assert.equal(before.tab.id, job.tabId);
  assert.equal(before.tab.active, true);
  assert.equal(before.tab.windowId, before.workspace?.windowId);
  assert.equal(before.workspace.tabId, job.tabId);
  assert.equal(before.window.focused, false);
  assert.equal(before.context.viewport.width, 600);
  assert.equal(before.debuggerAttached, true);
  assert.ok(before.ownershipKeys.includes(`pointer-session:${job.tabId}`));
  assert.ok(before.ownershipKeys.includes('advanced-scan-owner'));
  const running = before.ownedScanOwner;
  assert.equal(running?.phase, 'RUNNING');
  assert.equal(running.nonce, owner.nonce);
  assert.equal(running.createdAt, owner.createdAt);
  assert.deepEqual(running.source, owner.source);
  assert.equal(running.scanTabId, job.tabId);
  assert.equal(running.scanWindowId, owner.scanWindowId);
  assert.equal(running.jobId, job.id);
  assert.equal(running.generation, job.generation);
  assert.ok(hasActiveCapture(before, job.tabId) && hasLiveTrack(before));
  assert.ok(!hasActiveCapture(before, initial.tab.id));
  assert.ok(!before.debuggerTabIds.includes(initial.tab.id));
  assert.ok(
    frame.kind === 'FRAME_DONE' &&
      frame.frames >= 30 &&
      frame.generation === job.generation,
  );
  assert.ok(
    evidence.events.some(
      (event) =>
        event.kind === frame.kind &&
        event.segmentId === frame.segmentId &&
        event.generation === frame.generation &&
        event.frames === frame.frames &&
        event.at === frame.at,
    ),
  );
  const begin = evidence.events.findLast(
    (event) =>
      event.kind === 'SEGMENT_BEGIN' &&
      event.segmentId === frame.segmentId &&
      event.generation === job.generation,
  );
  assert.ok(begin && begin.at <= frame.at && frame.at <= before.at);
  for (const field of ['width', 'height', 'dpr'])
    assert.equal(
      begin.referenceMapping.viewport[field],
      before.context.viewport[field],
    );
  const width = Math.round(
    before.context.viewport.width * before.context.viewport.dpr,
  );
  const height = Math.round(
    before.context.viewport.height * before.context.viewport.dpr,
  );
  assert.ok(
    before.tracks.streams.some(
      (stream) =>
        stream.active &&
        stream.tracks.some(
          (track) =>
            track.readyState === 'live' &&
            track.settings.width === width &&
            track.settings.height === height &&
            track.settings.resizeMode === 'none',
        ),
    ),
  );
  if (cancellation) {
    const record = evidence.cancellation;
    assert.equal(record.jobId, job.id);
    assert.equal(record.scenario, 'compact-viewport');
    assert.equal(record.segmentId, frame.segmentId);
    assert.ok(before.at <= record.stopRequestedAt);
    assert.ok(
      !evidence.events.some(
        (event) =>
          event.kind === 'SEGMENT_END' &&
          event.segmentId === frame.segmentId &&
          event.at < record.stopRequestedAt,
      ),
    );
    assert.equal(job.state, 'PARTIAL');
    assert.equal(job.stopReason, 'USER_STOP');
    assert.equal(evidence.report.status, 'INCONCLUSIVE');
    assert.ok(owned.after.at >= record.stopRequestedAt);
    assert.deepEqual(record.after, owned.after);
  } else {
    assert.equal(
      evidence.cancellation,
      undefined,
      'Natural completion must not use fixture STOP.',
    );
    assert.ok(['COMPLETED', 'PARTIAL'].includes(job.state));
    assert.equal(job.stopIntent, false);
    assert.equal(job.stopReason, 'QUEUE_EXHAUSTED');
    const observation = job.tasks
      .flatMap((task) => task.observations)
      .find((value) => value.id === frame.segmentId);
    assert.equal(observation?.scenario, 'compact-viewport');
    assert.equal(observation.achieved, true);
    const quality = observation.measurement?.quality;
    assert.ok(
      quality && quality.frameCount >= 30 && quality.effectiveFps >= 50,
    );
    assert.equal(quality.interrupted, false);
    assert.equal(quality.downsampled, false);
    assert.equal(quality.width, width);
    assert.equal(quality.height, height);
    assert.ok(
      evidence.events.some(
        (event) =>
          event.kind === 'SEGMENT_END' &&
          event.segmentId === frame.segmentId &&
          event.generation === job.generation &&
          event.at >= before.at &&
          event.at <= owned.after.at,
      ),
    );
  }
  assert.ok(
    !job.limitations.some((value) =>
      /RESTORE_UNCONFIRMED|RELEASE_UNCONFIRMED|WORKSPACE_UNOWNED|MANUAL_RESTORE|ADVANCED_SCAN_.*(?:MANUAL|FAILED|CHANGED|RETAINED)/.test(
        value,
      ),
    ),
    'Owned cleanup uncertainty cannot be accepted.',
  );
  const after = owned.after;
  assert.ok(after.at >= before.at);
  assertOriginal(after.original);
  assert.equal(after.original.tab.active, false);
  assert.equal(after.original.window.focused, before.original.window.focused);
  assert.equal(after.original.foregroundTabId, before.original.foregroundTabId);
  assert.equal(after.foregroundTabId, before.foregroundTabId);
  assert.equal(after.tab, null, 'Owned scan tab must actually be gone.');
  assert.ok(!after.tabIds.includes(job.tabId));
  assert.ok(after.tabIds.includes(initial.tab.id));
  assert.ok(!after.windowIds.includes(before.workspace.windowId));
  assert.ok(after.windowIds.includes(initial.window.id));
  assert.deepEqual(after.ownershipKeys, []);
  assert.equal(after.ownedScanOwner, null);
  assert.equal(after.workspace, null);
  assert.equal(after.debuggerAttached, false);
  assert.ok(
    !after.debuggerTabIds.some((id) =>
      [job.tabId, initial.tab.id].includes(id),
    ),
  );
  assert.ok(
    !after.capturedTabs.some(
      (value) =>
        [job.tabId, initial.tab.id].includes(value.tabId) &&
        ['active', 'pending'].includes(value.status),
    ),
  );
  assert.ok(['CLOSED', 'OPEN'].includes(after.tracks.context));
  if (after.tracks.context === 'OPEN') {
    assert.ok(after.tracks.streams.length > 0);
    assert.ok(
      after.tracks.streams.every(
        (stream) =>
          !stream.active &&
          stream.tracks.length > 0 &&
          stream.tracks.every((track) => track.readyState === 'ended'),
      ),
    );
  }
  return {
    ...common,
    ownedScan: true,
    segmentId: frame.segmentId,
    processedFramesBeforeStop: cancellation ? frame.frames : undefined,
    originalDocumentPreserved: true,
    originalViewport: {
      width: initial.document.width,
      height: initial.document.height,
      dpr: initial.document.dpr,
    },
    ownedScanTabRemoved: true,
    workspaceRemoved: true,
    producerReleased: true,
    debuggerDetached: true,
    foregroundPreserved: true,
    scope: `One actual two-toolbar owned-scan ${cancellation ? 'compact cancellation' : 'natural completion with a measured compact viewport'} on this browser; no legacy original-WebContents restoration or hardware-wide guarantee.`,
  };
}
