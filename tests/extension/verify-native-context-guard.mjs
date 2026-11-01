import { verifyTabSwitchHypothesis } from './native-tab-switch-proof.mjs';
// Pure evidence checker. Usage: node verify-native-context-guard.mjs evidence.json
// This does not generate evidence or start/attach a browser.
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';

import { pathToFileURL } from 'node:url';

import { verifyCancellation } from './native-cancellation-proof.mjs';
import {
  hasActiveCapture,
  hash,
  hasLiveTrack,
  pixelFinding,
} from './native-context-proof-common.mjs';
import { verifyOwnedScan } from './native-owned-scan-proof.mjs';

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
  verifyTabSwitchHypothesis(evidence, common, job);
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
