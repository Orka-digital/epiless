// Pure evidence checker. Usage: node verify-native-context-guard.mjs evidence.json
// This does not generate evidence or start/attach a browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  assertTabSwitchContext,
  TAB_SWITCH_HYPOTHESIS,
} from './native-context-tab-switch.mjs';

const hash = /^[a-f0-9]{64}$/;
const pixelFinding = ({ id, type, startMs, endMs, region, spatial }) => {
  const result = structuredClone({ id, type, startMs, endMs, region, spatial });
  if (result.spatial) delete result.spatial.visualField;
  return result;
};
const hasActiveCapture = (snapshot, tabId) =>
  snapshot.capturedTabs.some(
    (value) =>
      value.tabId === tabId && ['active', 'pending'].includes(value.status),
  );
const hasLiveTrack = (snapshot) =>
  snapshot.tracks.context === 'OPEN' &&
  snapshot.tracks.streams.some(
    (stream) =>
      stream.active &&
      stream.tracks.some((track) => track.readyState === 'live'),
  );

export function verifyNativeContextGuard(evidence) {
  assert.equal(evidence.schemaVersion, 1);
  assert.ok(['zoom', 'resize', 'cancel', 'complete'].includes(evidence.mode));
  assert.deepEqual(
    evidence.errors,
    [],
    'Collector errors invalidate this integration proof.',
  );
  assert.equal(evidence.environment.headless, false);
  assert.equal(evidence.environment.playwrightAttached, false);
  const build = evidence.environment.extensionBuild;
  assert.match(build.productionSha256, hash);
  assert.match(build.instrumentedSha256, hash);
  assert.notEqual(build.productionSha256, build.instrumentedSha256);
  assert.ok(Object.keys(build.fixtureSourceSha256).length >= 5);
  for (const value of Object.values(build.fixtureSourceSha256))
    assert.match(value, hash);
  const job = evidence.job;
  assert.match(job.scannerBuildSha256, hash);
  assert.equal(evidence.report.scannerBuildSha256, job.scannerBuildSha256);
  assert.equal(
    evidence.report.passed,
    null,
    'No integration proof permits a safety pass.',
  );
  assert.ok(
    evidence.events.some((event) => event.kind === 'REAL_STREAM_CREATED'),
  );
  const common = {
    mode: evidence.mode,
    jobId: job.id,
    scannerBuildSha256: job.scannerBuildSha256,
    productionBundleSha256: build.productionSha256,
    instrumentedBundleSha256: build.instrumentedSha256,
  };
  if (evidence.ownedScan || evidence.environment.ownedScan) {
    assert.equal(evidence.environment.ownedScan, true);
    assert.ok(['cancel', 'complete'].includes(evidence.mode));
    assert.ok(!evidence.tabSwitchProbe && !evidence.environment.tabSwitchProbe);
    return verifyOwnedScan(evidence, common);
  }
  assert.notEqual(
    evidence.mode,
    'complete',
    'Completion requires explicit owned-scan evidence.',
  );
  if (evidence.tabSwitchProbe || evidence.hypothesis)
    assert.equal(
      evidence.environment.tabSwitchProbe,
      true,
      'A fixture intervention may not be presented as an ordinary cleanup proof.',
    );
  if (evidence.environment.tabSwitchProbe) {
    assert.equal(evidence.mode, 'cancel');
    assert.equal(evidence.environment.hypothesis, TAB_SWITCH_HYPOTHESIS);
    assert.equal(evidence.environment.productionAcceptance, false);
    assert.equal(evidence.productionAcceptance, false);
    const probe = evidence.tabSwitchProbe;
    assert.equal(
      probe?.status,
      'COMPLETED',
      'Hypothesis must actually run to completion.',
    );
    assert.equal(probe.hypothesis, TAB_SWITCH_HYPOTHESIS);
    assert.equal(probe.productionAcceptance, false);
    assert.equal(probe.plan.jobId, job.id);
    assert.equal(probe.plan.generation, job.generation);
    assert.deepEqual(probe.plan.before, evidence.cancellation.before);
    assert.ok(
      evidence.events.some(
        (event) =>
          event.kind === 'DEBUGGER_DETACH_REPLY' &&
          event.tabId === job.tabId &&
          event.at === probe.plan.detach.at &&
          event.requestId === probe.plan.detach.requestId,
      ),
    );
    const mutations = probe.steps.filter((step) => step.kind !== 'CONTEXT');
    assert.deepEqual(
      probe.steps.map((step) => step.label ?? step.kind),
      [
        'before-intent',
        'before-create',
        'CREATE_INACTIVE_BLANK',
        'after-create',
        'before-activate-blank',
        'ACTIVATE_BLANK',
        'after-activate-blank',
        'before-activate-source',
        'ACTIVATE_SOURCE',
        'after-activate-source',
        'before-remove-blank',
        'REMOVE_OWNED_BLANK',
        'after-remove-blank',
      ],
    );
    assert.deepEqual(
      mutations.map((step) => step.kind),
      [
        'CREATE_INACTIVE_BLANK',
        'ACTIVATE_BLANK',
        'ACTIVATE_SOURCE',
        'REMOVE_OWNED_BLANK',
      ],
    );
    assert.equal(mutations[0].result.id, probe.blankId);
    assert.deepEqual(
      mutations.slice(1).map((step) => step.targetTabId),
      [probe.blankId, job.tabId, probe.blankId],
    );
    const labels = [
      'before-intent',
      'before-create',
      'after-create',
      'before-activate-blank',
      'after-activate-blank',
      'before-activate-source',
      'after-activate-source',
      'before-remove-blank',
      'after-remove-blank',
    ];
    const contexts = probe.steps.filter((step) => step.kind === 'CONTEXT');
    assert.deepEqual(
      contexts.map((step) => step.label),
      labels,
    );
    let previousAt = probe.plan.detach.at;
    for (const step of probe.steps) {
      assert.ok(step.at >= previousAt);
      previousAt = step.repliedAt ?? step.at;
      if (step.kind !== 'CONTEXT') {
        assert.ok(step.repliedAt >= step.at);
        continue;
      }
      const hasBlank = ![
        'before-intent',
        'before-create',
        'after-remove-blank',
      ].includes(step.label);
      const blankActive = [
        'after-activate-blank',
        'before-activate-source',
      ].includes(step.label);
      assertTabSwitchContext(
        step.state,
        probe.plan,
        blankActive ? 'BLANK_ACTIVE' : 'SOURCE_ACTIVE',
        hasBlank ? probe.blankId : undefined,
        step.at,
      );
    }
    common.hypothesis = TAB_SWITCH_HYPOTHESIS;
    common.productionAcceptance = false;
  }
  if (evidence.mode === 'cancel') {
    const result = verifyCancellation(evidence, common);
    if (evidence.environment.tabSwitchProbe)
      result.scope =
        'Fixture-only tab-switch hypothesis after actual STOP. Strict geometry/resource assertions passed with this intervention; this is not unmodified-production cleanup acceptance.';
    return result;
  }
  const trip = evidence.roundTrip;
  assert.ok(
    trip?.before && trip.changed && trip.after,
    'Actual roundtrip snapshots required.',
  );
  assert.equal(trip.jobId, job.id);
  const events = evidence.events.filter(
    (event) =>
      event.segmentId === trip.segmentId && event.generation === job.generation,
  );
  const begin = events.find((event) => event.kind === 'SEGMENT_BEGIN');
  const candidate = events.find(
    (event) =>
      event.kind === 'WORKER_CANDIDATE' &&
      event.finding.id === trip.candidateId &&
      event.at <= trip.startedAt,
  );
  const end = events.find((event) => event.kind === 'SEGMENT_END');
  assert.ok(
    begin && candidate && end,
    'Same measured segment must bracket the whole roundtrip.',
  );
  assert.ok(
    begin.at <= candidate.at &&
      candidate.at <= trip.startedAt &&
      trip.startedAt <= trip.before.at &&
      trip.before.at < trip.changed.at &&
      trip.changed.at < trip.after.at &&
      trip.after.at <= trip.restoredAt &&
      trip.restoredAt < end.at,
  );
  assert.ok(
    events.some(
      (event) =>
        event.kind === 'FRAME_DONE' &&
        event.frames >= 1 &&
        event.at <= trip.startedAt,
    ),
  );
  assert.equal(
    candidate.finding.spatial?.visualField?.basis,
    'W3C_CSS_REFERENCE',
    'Candidate must actually have reference evidence before intervention.',
  );
  assert.ok(
    hasActiveCapture(trip.before, job.tabId) && hasLiveTrack(trip.before),
  );
  for (const endpoint of [trip.before, trip.after]) {
    assert.equal(endpoint.zoom, 1);
    assert.equal(endpoint.context.viewport.visualScale, 1);
    assert.equal(endpoint.context.viewport.visualOffsetLeft, 0);
    assert.equal(endpoint.context.viewport.visualOffsetTop, 0);
  }
  assert.equal(
    trip.before.context.documentToken,
    trip.after.context.documentToken,
  );
  assert.equal(trip.before.context.url, trip.after.context.url);
  for (const field of ['width', 'height', 'dpr'])
    assert.equal(
      trip.before.context.viewport[field],
      trip.after.context.viewport[field],
      `Endpoint ${field} must be restored.`,
    );
  if (evidence.mode === 'zoom') {
    assert.ok(Math.abs(trip.changed.zoom - 1.1) < 1e-6);
    const zoomEvents = evidence.zoomEvents.filter(
      (event) =>
        event.tabId === job.tabId &&
        event.at >= trip.startedAt &&
        event.at <= trip.restoredAt,
    );
    assert.ok(
      zoomEvents.some(
        (event) =>
          event.oldZoomFactor === 1 &&
          Math.abs(event.newZoomFactor - 1.1) < 1e-6,
      ),
    );
    assert.ok(
      zoomEvents.some(
        (event) =>
          Math.abs(event.oldZoomFactor - 1.1) < 1e-6 &&
          event.newZoomFactor === 1,
      ),
    );
  } else {
    assert.notEqual(
      trip.changed.context.viewport.width,
      trip.before.context.viewport.width,
      'Actual CSS resize required; outer-window API success is insufficient.',
    );
    assert.equal(trip.changed.zoom, 1);
  }
  assert.ok(
    Number.isSafeInteger(trip.before.context.viewportRevision) &&
      trip.after.context.viewportRevision >
        trip.before.context.viewportRevision,
    'A real transient context revision must be observed.',
  );
  const worker = events.findLast((event) => event.kind === 'WORKER_RESULT');
  const unguarded = worker?.findings.find(
    (finding) => finding.id === trip.candidateId,
  );
  assert.equal(
    unguarded?.spatial?.visualField?.basis,
    'W3C_CSS_REFERENCE',
    'Worker result must precede removal by the real background guard.',
  );
  const observation = job.tasks
    .flatMap((task) => task.observations)
    .find((value) => value.id === trip.segmentId);
  const guarded = observation?.measurement?.findings.find(
    (finding) => finding.id === trip.candidateId,
  );
  assert.ok(guarded, 'Candidate was lost during transient change.');
  assert.equal(guarded.spatial.visualField, undefined);
  assert.deepEqual(
    pixelFinding(guarded),
    pixelFinding(unguarded),
    'Only reference evidence may be removed; measured pixel/timing evidence must survive unchanged.',
  );
  assert.ok(
    observation.measurement.limitations.includes(
      'CSS_REFERENCE_CONTEXT_CHANGED_OR_UNAVAILABLE',
    ),
  );
  const exported = evidence.report.routes
    .flatMap((route) => route.scenarios)
    .find((value) => value.id === trip.segmentId);
  const exportedFinding = exported?.findings.find(
    (finding) => finding.id === trip.candidateId,
  );
  assert.ok(exportedFinding, 'Candidate must survive actual export.');
  assert.equal(exportedFinding.spatial.visualField, undefined);
  assert.deepEqual(pixelFinding(exportedFinding), pixelFinding(guarded));
  assert.ok(
    evidence.report.limitations.includes(
      'CSS_REFERENCE_CONTEXT_CHANGED_OR_UNAVAILABLE',
    ),
  );
  assert.equal(
    exported.quality.interrupted,
    observation.measurement.quality.interrupted,
  );
  if (observation.measurement.quality.interrupted) {
    assert.equal(observation.measurement.status, 'INCONCLUSIVE');
    assert.equal(evidence.report.status, 'INCONCLUSIVE');
  }
  return {
    ...common,
    segmentId: trip.segmentId,
    candidateId: trip.candidateId,
    candidateRetained: true,
    cssReferenceRemoved: true,
    endpointGeometryRestored: true,
    quality: observation.measurement.quality,
    scope:
      'Instrumented real-toolbar transient context guard; no uninterrupted-capture or performance claim.',
  };
}

function verifyOwnedScan(evidence, common) {
  const { job, ownedScan: owned } = evidence;
  assert.equal(
    evidence.environment.extensionBuild.embeddedScannerBuildSha256,
    job.scannerBuildSha256,
    'Actual cold-build identity must match the owned scan job.',
  );
  assert.equal(owned?.version, 1);
  const initial = owned.originalInitial,
    prepared = owned.preparation;
  assert.ok(
    initial && prepared?.owner && prepared.original && owned.after,
    'Original pre-PREPARE and actual PREPARED snapshots are required.',
  );
  const owner = prepared.owner;
  assert.equal(owner.version, 1);
  assert.equal(owner.phase, 'PREPARED');
  assert.ok(typeof owner.nonce === 'string' && owner.nonce.length >= 16);
  assert.ok(Number.isFinite(owner.createdAt));
  assert.ok(
    initial.at <= owner.createdAt &&
      owner.createdAt <= prepared.at &&
      prepared.at < Date.parse(job.startedAt),
    'Original evidence must precede the real preparation and second toolbar start.',
  );
  assert.equal(initial.document.width, 900);
  assert.equal(initial.document.height, 507);
  assert.ok(
    initial.document.at <= initial.at &&
      initial.at - initial.document.at < 1500,
  );
  assert.ok(
    typeof initial.document.documentId === 'string' &&
      initial.document.documentId.length >= 16,
  );
  assert.ok(Number.isFinite(initial.document.timeOrigin));
  assert.equal(initial.tab.active, true);
  assert.equal(initial.window.focused, true);
  assert.equal(initial.foregroundTabId, initial.tab.id);
  assert.equal(owner.source.tabId, initial.tab.id);
  assert.equal(owner.source.windowId, initial.tab.windowId);
  assert.equal(owner.source.index, initial.tab.index);
  assert.equal(owner.source.url, initial.document.url);
  assert.equal(owner.source.context.url, owner.source.url);
  for (const field of ['width', 'height', 'left', 'top'])
    assert.equal(owner.source.window[field], initial.window[field]);
  assert.ok(
    typeof owner.source.context.documentToken === 'string' &&
      owner.source.context.documentToken.length >= 16,
  );
  assert.equal(owner.scanTabId, job.tabId);
  assert.notEqual(
    job.tabId,
    initial.tab.id,
    'Capture must use the disposable tab, never the original.',
  );
  assert.equal(owner.scanWindowId, initial.tab.windowId);
  assert.equal(job.disposableSource?.nonce, owner.nonce);
  assert.equal(job.disposableSource.originalTabId, initial.tab.id);
  assert.equal(job.disposableSource.originalUrl, owner.source.url);
  assert.equal(job.disposableSource.closed, true);
  assert.equal(job.disposableSource.cleanupStatus, 'CLOSED');
  assert.ok(
    !prepared.capturedTabs.some(
      (value) =>
        [owner.scanTabId, initial.tab.id].includes(value.tabId) &&
        ['active', 'pending'].includes(value.status),
    ),
    'PREPARE alone must not start capture.',
  );
  assert.ok(
    !prepared.debuggerTabIds.some((id) =>
      [owner.scanTabId, initial.tab.id].includes(id),
    ),
    'PREPARE alone must not attach the debugger.',
  );

  const assertOriginal = (snapshot) => {
    assert.ok(
      snapshot?.document && snapshot.context,
      'Current original document evidence is required.',
    );
    for (const field of ['id', 'windowId', 'index', 'url', 'pinned', 'groupId'])
      assert.equal(
        snapshot.tab[field],
        initial.tab[field],
        `Original tab ${field} changed.`,
      );
    for (const field of ['id', 'width', 'height', 'left', 'top'])
      assert.equal(
        snapshot.window[field],
        initial.window[field],
        `Original window ${field} changed.`,
      );
    for (const field of [
      'documentId',
      'url',
      'timeOrigin',
      'width',
      'height',
      'dpr',
    ])
      assert.equal(
        snapshot.document[field],
        initial.document[field],
        `Original page ${field} changed.`,
      );
    assert.equal(snapshot.zoom, initial.zoom);
    assert.equal(
      snapshot.context.documentToken,
      owner.source.context.documentToken,
    );
    assert.equal(snapshot.context.url, owner.source.context.url);
    assert.deepEqual(snapshot.context.viewport, owner.source.context.viewport);
    if (owner.source.context.viewportRevision !== undefined)
      assert.equal(
        snapshot.context.viewportRevision,
        owner.source.context.viewportRevision,
      );
    for (const field of ['width', 'height', 'dpr'])
      assert.equal(snapshot.context.viewport[field], initial.document[field]);
  };
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

function verifyCancellation(evidence, common) {
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(process.argv.length, 3, 'Provide one evidence.json path.');
  console.log(
    JSON.stringify(
      verifyNativeContextGuard(
        JSON.parse(await readFile(process.argv[2], 'utf8')),
      ),
      null,
      2,
    ),
  );
}
