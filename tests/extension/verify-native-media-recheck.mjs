// Genuine native exports only. This explicit video variant does not change the
// original CSS recheck verifier or the product comparison requirements.
// Usage: node --import tsx tests/extension/verify-native-media-recheck.mjs \
//   baseline-job baseline-env fixed-job fixed-env recurrence-job recurrence-env
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compareVerification } from '../../apps/chrome-extension/src/verification.ts';
import {
  measuredMediaInterval,
  mediaComparisonReasons,
} from '../../apps/chrome-extension/src/media-replay.ts';
import {
  validPhaseEvidence,
  phaseComparisonReasons,
} from '../../apps/chrome-extension/src/animation-phase.ts';
import {
  loadNativeEncodedAssets,
  encodedFrames,
  encodedSpec,
  sha256,
} from './native-encoded-source.mjs';
import {
  recheckMediaPath,
  recheckPolicy,
  encodedRecheckHtml,
} from './native-encoded-recheck-source.mjs';

const expectedModuleSha256 = sha256(
  readFileSync(new URL('./native-encoded-recheck-source.mjs', import.meta.url)),
);
export function verifyRecheckProvenance(environment, assets, fixed, identity) {
  assert.equal(environment.extensionBuild.algorithm, 'sha256');
  assert.equal(
    environment.extensionBuild.input,
    'sorted dist filenames, NUL, bytes, NUL',
  );
  assert.match(environment.extensionBuild.digest, /^[a-f0-9]{64}$/);
  assert.equal(environment.encodedRecheck.moduleSha256, expectedModuleSha256);
  const served = environment.encodedRecheck.documents.find(
    (record) => record.documentId === identity.documentId,
  );
  assert.ok(served);
  const asset = assets.assets[fixed ? 'fixed' : 'signal'];
  const expectedIdentity = {
    documentId: identity.documentId,
    fixed,
    url: recheckMediaPath,
    sourceSha256: asset.record.sha256,
    sourceBytes: asset.bytes.length,
    manifestSha256: assets.manifestSha256,
  };
  assert.deepEqual(identity, expectedIdentity);
  assert.equal(
    served.servedHtmlSha256,
    sha256(encodedRecheckHtml(assets, fixed, expectedIdentity)),
  );
  return served;
}

/** Page traces outlive the measurement: normal replay cleanup restores the
 * pre-replay video position afterwards. It cannot excuse any seek while measured. */
export function verifyMeasuredMediaEvents(
  events,
  startEpochMs,
  endEpochMs,
  originalTimeMs,
  observationEndEpochMs = endEpochMs,
) {
  assert.ok(
    Number.isFinite(startEpochMs) &&
      Number.isFinite(endEpochMs) &&
      endEpochMs >= startEpochMs,
  );
  assert.ok(Number.isFinite(originalTimeMs) && originalTimeMs >= 0);
  assert.ok(Number.isFinite(observationEndEpochMs));
  const endedAt = Math.max(endEpochMs, observationEndEpochMs);
  assert.ok(
    !events.some((event) =>
      [
        'MEDIA_ERROR',
        'RVFC_UNAVAILABLE',
        'ENCODED_TIMESTAMP_UNMATCHED',
      ].includes(event.kind),
    ),
  );
  const restoration = events.filter((event) => event.kind === 'EXPLICIT_SEEK');
  assert.ok(
    restoration.length <= 1,
    'At most one post-measurement restoration seek is supported.',
  );
  for (const event of restoration) {
    assert.ok(
      Number.isFinite(event.at) && event.at > endedAt,
      'No seek before or during the measured interval is admissible.',
    );
    assert.equal(
      event.mediaTime * 1000,
      originalTimeMs,
      'A later seek must restore exactly the original saved media position.',
    );
  }
  return restoration.map((event) => ({
    atEpochMs: event.at,
    afterMeasurementMs: event.at - endEpochMs,
    afterObservationMs: event.at - endedAt,
    restoredTimeMs: originalTimeMs,
  }));
}

export function verifyRecheckOrder(jobs) {
  assert.equal(jobs.length, 3);
  assert.equal(
    new Set(jobs.map((job) => job.id)).size,
    3,
    'Three distinct native jobs are required.',
  );
  for (let index = 1; index < jobs.length; index++)
    assert.ok(
      Date.parse(jobs[index].startedAt) > Date.parse(jobs[index - 1].endedAt),
      'The fixed run must follow baseline and recurrence must follow the completed fixed run.',
    );
}

export function verifyNativeMediaRecheck(jobs, environments, assets) {
  verifyRecheckOrder(jobs);
  assert.equal(jobs.length, 3);
  assert.equal(environments.length, 3);
  const [baseline, fixed, recurrence] = jobs;
  const candidates = baseline.tasks.flatMap((task) =>
    task.observations.flatMap((observation) =>
      observation.replay?.profile === 'current' &&
      observation.replay?.measuredStep !== undefined &&
      observation.replay.steps[observation.replay.measuredStep]?.kind ===
        'control'
        ? (observation.measurement?.findings ?? [])
            .filter((finding) => finding.type === 'GENERAL_FLASH')
            .map((finding) => ({ task, observation, finding }))
        : [],
    ),
  );
  assert.equal(
    candidates.length,
    1,
    'Exactly one current-profile control candidate; compact candidates are separate.',
  );
  const original = candidates[0];
  const anchor = {
    taskId: original.task.id,
    observationId: original.observation.id,
    findingId: original.finding.id,
  };
  assert.match(baseline.scannerBuildSha256, /^[a-f0-9]{64}$/);
  const measurements = [];
  const independentDocuments = [];
  for (const [index, job] of jobs.entries()) {
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
    assert.equal(
      environment.encodedSource.manifestSha256,
      assets.manifestSha256,
    );
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
    assert.equal(observation.achieved, true);
    assert.equal(observation.replay.profile, 'current');
    assert.equal(observation.replay.viewportMethod, 'PHYSICAL');
    assert.deepEqual(observation.replay, original.observation.replay);
    assert.equal(quality.downsampled, false);
    assert.equal(quality.interrupted, false);
    assert.equal(quality.spatial.retainedResolutionRatio, 1);
    assert.ok(quality.width * quality.height >= 500000);
    assert.ok(quality.effectiveFps >= 50 && quality.maxGapMs <= 100);
    assert.equal(quality.droppedFrames ?? 0, 0);
    assert.ok(
      validPhaseEvidence(observation.phaseEvidence),
      'Current native acceptance requires actual document/animation clocks.',
    );
    assert.equal(observation.phaseEvidence.complete, true);
    assert.deepEqual(observation.phaseEvidence.reasons, []);
    assert.equal(observation.replay.phasePlan.status, 'REPLAYABLE');
    assert.equal(observation.mediaEvidence.complete, true);
    assert.deepEqual(observation.mediaEvidence.reasons, []);
    assert.equal(observation.mediaEvidence.items.length, 1);
    assert.equal(observation.replay.mediaPlan.status, 'REPLAYABLE');
    const media = observation.mediaEvidence.items[0],
      before = media.before;
    assert.equal(before.sourceKind, 'URL');
    assert.equal(
      before.locatorSha256,
      sha256(new URL(recheckMediaPath, job.origin).href),
    );
    assert.equal(before.durationMs, encodedSpec.durationMs);
    assert.equal(before.timeMs, 0);
    assert.equal(before.playbackRate, 1);
    assert.equal(before.loop, false);
    assert.equal(before.paused, true);
    assert.deepEqual(before.seekable, [[0, encodedSpec.durationMs]]);
    assert.deepEqual(
      before,
      original.observation.mediaEvidence.items[0].before,
    );
    const interval = measuredMediaInterval(media);
    assert.ok(
      interval,
      'Actual samples and compositor submissions must prove continuity.',
    );
    assert.equal(interval.startMs, 0);
    assert.equal(interval.endMs, encodedSpec.durationMs);
    const frames = media.presentations;
    assert.ok(frames.length >= 52 && frames.length <= 53);
    assert.ok(frames[0].timeMs === 0 || frames[0].timeMs === 40);
    assert.equal(frames.at(-1).timeMs, 2080);
    for (let n = 1; n < frames.length; n++) {
      assert.equal(frames[n].timeMs - frames[n - 1].timeMs, 40);
      assert.equal(
        frames[n].presentedFrames - frames[n - 1].presentedFrames,
        1,
      );
    }
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
  assert.notEqual(
    assets.assets.signal.record.sha256,
    assets.assets.fixed.record.sha256,
  );
  assert.equal(
    new Set(independentDocuments.map((value) => value.documentId)).size,
    3,
    'Each run must observe a fresh document.',
  );
  const comparisons = [fixed, recurrence].map((job) =>
    compareVerification(baseline, anchor, job),
  );
  assert.deepEqual(
    comparisons.map((value) => value.status),
    ['NOT_OBSERVED', 'REOBSERVED'],
    JSON.stringify(comparisons),
  );
  for (const job of [fixed, recurrence]) {
    const repeated = job.tasks
      .flatMap((task) => task.observations)
      .find(
        (observation) =>
          observation.replay?.stateKey === original.observation.replay.stateKey,
      );
    assert.deepEqual(
      mediaComparisonReasons(original.observation, repeated, original.finding),
      [],
    );
    assert.deepEqual(
      phaseComparisonReasons(original.observation, repeated, original.finding),
      [],
      'The genuine candidate frame-clock window and original document interval must both be covered.',
    );
  }
  return {
    status: 'PASS',
    scope:
      'One genuine native encoded-video current-profile control, same-build targeted site-content fix and recurrence. No normative, broad video, hardware or causal guarantee.',
    scannerBuildSha256: baseline.scannerBuildSha256,
    extensionBuild: environments[0].extensionBuild,
    anchor,
    comparison: {
      fixed: comparisons[0].status,
      recurrence: comparisons[1].status,
    },
    measurements,
    independentDocuments,
    sourceIdentity:
      'The same URL intentionally serves different source bytes during the fix. Independent manifest/request hashes prove this fixture change; the scanner only proves locator and observed media-interval compatibility.',
    sourceManifestSha256: assets.manifestSha256,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const filenames = process.argv.slice(2);
  assert.equal(
    filenames.length,
    6,
    'Provide three native local-job/environment pairs.',
  );
  const values = await Promise.all(
    filenames.map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
  );
  const assets = await loadNativeEncodedAssets();
  console.log(
    JSON.stringify(
      verifyNativeMediaRecheck(
        [values[0], values[2], values[4]],
        [values[1], values[3], values[5]],
        assets,
      ),
      null,
      2,
    ),
  );
}
