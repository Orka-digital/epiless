import { verifyRecheckMediaClock } from './native-recheck-media-clock.mjs';
import { assertRecheckCaptureQuality } from './native-recheck-quality-proof.mjs';
// Genuine native exports only. This explicit video variant does not change the
// original CSS recheck verifier or the product comparison requirements.
// Usage: node --import tsx tests/extension/verify-native-media-recheck.mjs \
//   baseline-job baseline-env fixed-job fixed-env recurrence-job recurrence-env
import assert from 'node:assert/strict';

import { encodedFrames } from './native-encoded-source.mjs';

import {
  recheckMediaPath,
  recheckPolicy,
} from './native-encoded-recheck-source.mjs';

import {
  verifyMeasuredMediaEvents,
  verifyRecheckProvenance,
} from './native-recheck-provenance.mjs';
/** Validate each native recheck against its original measurement, build identity and independent document. */
export function verifyMediaRecheckMeasurement({
  environments,
  index,
  assets,
  job,
  baseline,
  original,
  measurements,
  independentDocuments,
}) {
  const environment = environments[index],
    expectedFixed = index === 1;
  const asset = assets.assets[expectedFixed ? 'fixed' : 'signal'];
  assert.equal(job.scannerBuildSha256, baseline.scannerBuildSha256);
  assert.match(environment.extensionBuild.digest, /^[a-f0-9]{64}$/);
  assert.equal(
    environment.extensionBuild.embeddedScannerBuildSha256,
    job.scannerBuildSha256,
  );
  assert.equal(environment.headless, false);
  assert.equal(environment.emulateViewport, false);
  assert.equal(
    environment.extensionBuild.digest,
    environments[0].extensionBuild.digest,
  );
  assert.deepEqual(environment.encodedRecheck.policy, recheckPolicy);
  assert.match(environment.encodedRecheck.moduleSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    environment.encodedRecheck.moduleSha256,
    environments[0].encodedRecheck.moduleSha256,
  );
  assert.equal(environment.encodedSource.manifestSha256, assets.manifestSha256);
  assert.deepEqual(environment.encodedSource.manifest, assets.manifest);
  const observations = job.tasks
    .flatMap((task) => task.observations)
    .filter(
      (observation) =>
        observation.replay?.stateKey === original.observation.replay.stateKey,
    );
  assert.equal(
    observations.length,
    1,
    'Exactly one genuinely measured original recipe.',
  );
  const observation = observations[0],
    quality = observation.measurement?.quality;
  assertRecheckCaptureQuality({ observation, original, quality });
  const { before, interval, frames } = verifyRecheckMediaClock({
    observation,
    job,
    original,
  });
  const start = observation.mediaEvidence.startedEpochMs,
    end = observation.mediaEvidence.endedEpochMs;
  const documents = environment.encodedRecheck.pageEvidence.filter(
    (page) =>
      page.recheckDocument.fixed === expectedFixed &&
      page.events.some(
        (event) =>
          event.kind === 'CONTROL' && event.at >= start && event.at <= end,
      ),
  );
  assert.equal(
    documents.length,
    1,
    'One independent served document must contain the actual control interval.',
  );
  const page = documents[0],
    identity = page.recheckDocument;
  const served = verifyRecheckProvenance(
    environment,
    assets,
    expectedFixed,
    identity,
  );
  assert.ok(served);
  assert.equal(served.sourceSha256, asset.record.sha256);
  assert.equal(served.sourceBytes, asset.bytes.length);
  assert.equal(served.url, recheckMediaPath);
  assert.match(served.servedHtmlSha256, /^[a-f0-9]{64}$/);
  assert.equal(identity.sourceSha256, asset.record.sha256);
  assert.equal(identity.manifestSha256, assets.manifestSha256);
  assert.equal(page.source, 'ENCODED_VP9_WEBM');
  assert.equal(page.fixed, expectedFixed);
  assert.equal(page.encoded.url, recheckMediaPath);
  assert.equal(page.encoded.sourceSha256, asset.record.sha256);
  assert.deepEqual(page.encoded.frames, encodedFrames(expectedFixed));
  const restoration = verifyMeasuredMediaEvents(
    page.events,
    start,
    end,
    before.timeMs,
    Date.parse(observation.endedAt),
  );
  const control = page.events.find((event) => event.kind === 'CONTROL');
  assert.ok(page.events.some((event) => event.kind === 'ENCODED_ENDED'));
  assert.ok(
    page.events
      .filter((event) => event.kind === 'ENCODED_PLAYING')
      .every((event) => event.at >= control.at),
  );
  const requests = environment.encodedRecheck.requests.filter(
    (request) => request.documentId === identity.documentId,
  );
  assert.ok(requests.some((request) => request.method === 'GET'));
  for (const request of requests) {
    assert.equal(request.path, recheckMediaPath);
    assert.equal(request.sourceSha256, asset.record.sha256);
    assert.equal(request.sourceBytes, asset.bytes.length);
  }
  for (const frame of frames) {
    const actual = page.presentations.find(
      (value) =>
        value.presentedFrames === frame.presentedFrames &&
        Math.abs(value.mediaTime * 1000 - frame.timeMs) < 0.001,
    );
    assert.ok(
      actual,
      'Every registered rVFC point must also occur in independent page metadata.',
    );
    const expected = asset.record.frames[Math.round(frame.timeMs / 40)];
    assert.equal(actual.expectedDecodedFrame.rgbaSha256, expected.rgbaSha256);
    assert.ok(
      Math.abs(actual.callbackEpochMs - (start + frame.atMs)) <= 20,
      'The independent callback must belong to this real observation, with a bounded metadata-read scheduling difference.',
    );
  }
  if (!expectedFixed) {
    const finding = observation.measurement.findings.find(
      (value) => value.type === 'GENERAL_FLASH',
    );
    assert.ok(finding);
    assert.deepEqual(finding.region, { x: 200, y: 480, width: 4, height: 4 });
    assert.ok(finding.spatial.simultaneousRatio < 0.001);
    assert.equal(finding.sourceTimeline.status, 'CORRELATED');
    assert.equal(finding.sourceTimeline.alignmentUncertaintyMs, null);
    const video = finding.sourceTimeline.candidates.find(
      (candidate) => candidate.media === 'VIDEO' && candidate.tag === 'video',
    );
    assert.ok(video);
    const samples = video.observations.filter(
      (sample) => sample.videoPresentation && sample.mediaPaused === false,
    );
    assert.ok(samples.length >= 2);
    let matching = 0;
    for (const sample of samples) {
      assert.deepEqual(sample.rect, { x: 100, y: 240, width: 2, height: 2 });
      const actual = page.presentations.find(
        (value) =>
          value.presentedFrames === sample.videoPresentation.presentedFrames,
      );
      if (!actual) continue;
      assert.equal(
        sample.videoPresentation.mediaTimeMs,
        actual.mediaTime * 1000,
      );
      assert.equal(
        sample.videoPresentation.presentationEpochMs,
        actual.presentationEpochMs,
      );
      assert.equal(
        sample.videoPresentation.expectedDisplayEpochMs,
        actual.expectedDisplayEpochMs,
      );
      matching++;
    }
    assert.ok(
      matching >= 2,
      'Correlated video timing must match independent real presentation metadata.',
    );
    const colours = new Set();
    assert.ok(finding.diagnostic?.samples.length > 0);
    for (const sample of finding.diagnostic.samples) {
      const nearest = [35, 125]
        .map((grey) => ({
          grey,
          error: Math.max(
            Math.abs(sample.red - grey),
            Math.abs(sample.green - grey),
            Math.abs(sample.blue - grey),
          ),
        }))
        .sort((a, b) => a.error - b.error)[0];
      assert.ok(nearest.error <= 2);
      colours.add(nearest.grey);
    }
    assert.deepEqual(
      [...colours].sort((a, b) => a - b),
      [35, 125],
    );
  } else
    assert.ok(
      !observation.measurement.findings.some(
        (finding) => finding.type === 'GENERAL_FLASH',
      ),
    );
  measurements.push({
    jobId: job.id,
    observationId: observation.id,
    fixed: expectedFixed,
    frames: quality.frameCount,
    fps: quality.effectiveFps,
    maxGapMs: quality.maxGapMs,
    sourceWidth: quality.width,
    sourceHeight: quality.height,
    mediaPresentations: frames.length,
    mediaInterval: interval,
    phase: {
      start: observation.phaseEvidence.start,
      end: observation.phaseEvidence.end,
      mode: observation.replay.phasePlan.mode,
      animationCount: observation.phaseEvidence.animations.length,
    },
    postMeasurementRestoration: restoration,
  });
  independentDocuments.push({
    documentId: identity.documentId,
    sourceSha256: asset.record.sha256,
    servedHtmlSha256: served.servedHtmlSha256,
  });
}
