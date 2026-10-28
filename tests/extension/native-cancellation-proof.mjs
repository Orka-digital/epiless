// Pure evidence checker. Usage: node verify-native-context-guard.mjs evidence.json
// This does not generate evidence or start/attach a browser.
import assert from 'node:assert/strict';

import {
  hasActiveCapture,
  hasLiveTrack,
} from './native-context-proof-common.mjs';

export function verifyCancellation(evidence, common) {
  const { job, cancellation: record } = evidence;
  assert.ok(
    record?.before && record.after,
    'Cancellation must be exercised, not inferred from natural completion.',
  );
  assert.equal(record.jobId, job.id);
  assert.equal(record.scenario, 'compact-viewport');
  const before = record.before,
    after = record.after,
    workspace = before.workspace;
  assert.equal(before.jobState, 'RUNNING');
  assert.equal(before.pendingAction, 'compact-viewport');
  assert.ok(workspace && workspace.tabId === job.tabId);
  assert.equal(before.tab.windowId, workspace.windowId);
  assert.equal(before.tab.active, true);
  assert.equal(before.window.focused, false);
  assert.equal(before.originalWindow.focused, true);
  assert.equal(
    before.debuggerAttached,
    true,
    'Advanced debugger lifecycle must actually be exercised.',
  );
  assert.ok(
    before.ownershipKeys.includes(`pointer-session:${job.tabId}`),
    'The real debugger owner must be persisted before STOP.',
  );
  assert.ok(
    hasActiveCapture(before, job.tabId) && hasLiveTrack(before),
    'A genuine active producer must precede STOP.',
  );
  const frame = record.acceptedFrame;
  assert.ok(
    frame?.kind === 'FRAME_DONE' &&
      frame.frames >= 30 &&
      frame.segmentId === record.segmentId &&
      frame.generation === job.generation,
  );
  assert.ok(
    evidence.events.some(
      (value) =>
        value.kind === 'FRAME_DONE' &&
        value.segmentId === frame.segmentId &&
        value.at === frame.at &&
        value.frames === frame.frames,
    ),
  );
  const begin = evidence.events.findLast(
    (value) =>
      value.kind === 'SEGMENT_BEGIN' && value.segmentId === record.segmentId,
  );
  assert.ok(
    begin &&
      begin.at <= frame.at &&
      frame.at <= before.at &&
      before.at <= record.stopRequestedAt,
  );
  assert.equal(
    before.context.viewport.width,
    600,
    'The compact CSS layout must actually be reached.',
  );
  for (const field of ['width', 'height', 'dpr'])
    assert.equal(
      begin.referenceMapping.viewport[field],
      before.context.viewport[field],
    );
  assert.ok(
    before.tracks.streams.some(
      (stream) =>
        stream.active &&
        stream.tracks.some(
          (track) =>
            track.readyState === 'live' &&
            track.settings.width ===
              Math.round(
                before.context.viewport.width * before.context.viewport.dpr,
              ) &&
            track.settings.height ===
              Math.round(
                before.context.viewport.height * before.context.viewport.dpr,
              ),
        ),
    ),
    'Real producer dimensions must match actual compact source pixels.',
  );
  assert.ok(
    !evidence.events.some(
      (value) =>
        value.kind === 'SEGMENT_END' &&
        value.segmentId === record.segmentId &&
        value.at < record.stopRequestedAt,
    ),
    'STOP must happen during the measured compact segment.',
  );
  assert.equal(job.state, 'PARTIAL');
  assert.equal(job.stopReason, 'USER_STOP');
  assert.equal(evidence.report.status, 'INCONCLUSIVE');
  assert.ok(
    !job.limitations.some((value) =>
      /RESTORE_UNCONFIRMED|RELEASE_UNCONFIRMED|WORKSPACE_UNOWNED/.test(value),
    ),
    'Cleanup uncertainty is a failure, never a successful cancellation.',
  );
  assert.ok(after.at >= record.stopRequestedAt);
  assert.equal(after.tab.windowId, workspace.originalWindowId);
  assert.equal(after.tab.index, workspace.originalIndex);
  assert.equal(after.tab.active, false);
  assert.equal(after.foregroundTabId, before.foregroundTabId);
  assert.equal(after.originalWindow.focused, true);
  for (const field of ['width', 'height', 'left', 'top'])
    assert.equal(
      after.originalWindow[field],
      workspace.originalWindow[field],
      `Original ${field} must be restored.`,
    );
  assert.ok(
    !after.windowIds.includes(workspace.windowId),
    'Owned empty workspace must be closed by tab restoration.',
  );
  assert.deepEqual(after.ownershipKeys, []);
  assert.equal(after.workspace, null);
  assert.equal(after.debuggerAttached, false);
  assert.equal(hasActiveCapture(after, job.tabId), false);
  assert.ok(
    ['CLOSED', 'OPEN'].includes(after.tracks.context),
    'Missing track query response is not evidence of release.',
  );
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
  const initial = evidence.geometryBeforeStart;
  assert.ok(
    initial && Date.parse(job.startedAt) - initial.at < 1500,
    'Recent actual page geometry before toolbar capture is required.',
  );
  for (const field of ['width', 'height', 'dpr'])
    assert.equal(
      after.context.viewport[field],
      initial[field],
      `Actual CSS ${field} must return to pre-capture geometry after debugger release.`,
    );
  return {
    ...common,
    segmentId: record.segmentId,
    processedFramesBeforeStop: frame.frames,
    producerReleased: true,
    trackEvidence:
      after.tracks.context === 'OPEN'
        ? 'All retained real tracks ended'
        : 'Offscreen context closed and browser reports no active/pending capture',
    debuggerDetached: true,
    workspaceRemoved: true,
    originalTabWindowAndForegroundRestored: true,
    scope:
      'One actual compact-source cancellation; no claim about browser crashes or other devices.',
  };
}
