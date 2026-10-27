// Usage: node tests/extension/verify-native-encoded.mjs local-job.json environment.json [asset-directory]
// Emits explicit FAIL evidence (exit 2) for inadequate capture; never upgrades it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  encodedFrames,
  encodedSpec,
  loadNativeEncodedAssets,
} from './native-encoded-source.mjs';

export function verifyNativeEncoded(job, environment, assets) {
  const errors = [];
  const check = (scope, callback) => {
    try {
      callback();
    } catch (error) {
      errors.push({ scope, reason: String(error.message ?? error) });
    }
  };
  const fixture = environment.candidateFixture;
  check('source-file-identity', () => {
    assert.equal(fixture?.source, 'ENCODED_VP9_WEBM');
    assert.equal(fixture.video, true);
    assert.equal(fixture.fixed, false);
    assert.equal(fixture.dense, false);
    assert.equal(
      fixture.encoded.sourceSha256,
      assets.assets.signal.record.sha256,
    );
    assert.equal(fixture.encoded.manifestSha256, assets.manifestSha256);
    assert.equal(
      environment.encodedSource.manifestSha256,
      assets.manifestSha256,
    );
    assert.deepEqual(environment.encodedSource.manifest, assets.manifest);
    assert.deepEqual(fixture.encoded.frames, encodedFrames(false));
    assert.match(job.scannerBuildSha256, /^[a-f0-9]{64}$/);
  });
  check('playback-and-disclosure', () => {
    const events = fixture.events;
    assert.ok(
      !events.some((value) =>
        [
          'MEDIA_ERROR',
          'RVFC_UNAVAILABLE',
          'ENCODED_TIMESTAMP_UNMATCHED',
        ].includes(value.kind),
      ),
    );
    const control = events.find((value) => value.kind === 'CONTROL');
    const playing = events.filter((value) => value.kind === 'ENCODED_PLAYING');
    assert.ok(control && playing.length > 0);
    assert.ok(
      playing.every((value) => value.at >= control.at),
      'No playback before disclosure.',
    );
    assert.ok(events.some((value) => value.kind === 'ENCODED_ENDED'));
    const metadata = events.find((value) => value.kind === 'ENCODED_METADATA');
    assert.equal(metadata.videoWidth, 2);
    assert.equal(metadata.videoHeight, 2);
    assert.ok(Math.abs(metadata.duration * 1000 - encodedSpec.durationMs) <= 1);
    assert.ok(fixture.presentations.length >= 20);
    const observedColours = new Set();
    for (const presentation of fixture.presentations) {
      const expected =
        assets.assets.signal.record.frames[
          Math.round(
            (presentation.mediaTime * 1000) / encodedSpec.frameDurationMs,
          )
        ];
      assert.ok(expected);
      assert.ok(
        Math.abs(presentation.mediaTime * 1000 - expected.timestampMs) < 0.1,
      );
      assert.deepEqual(presentation.expectedDecodedFrame, {
        index: expected.index,
        timestampMs: expected.timestampMs,
        rgba: expected.rgba,
        rgbaSha256: expected.rgbaSha256,
      });
      assert.equal(presentation.videoWidth, 2);
      assert.equal(presentation.videoHeight, 2);
      assert.deepEqual(presentation.rect, {
        x: 100,
        y: 240,
        width: 2,
        height: 2,
      });
      if (presentation.at < control.at)
        assert.equal(
          expected.rgba[0],
          35,
          'No changed signal may be shown before disclosure.',
        );
      observedColours.add(expected.rgba[0]);
    }
    assert.deepEqual(
      [...observedColours].sort((a, b) => a - b),
      [35, 125],
    );
  });
  const measurements = [];
  let matchingCompactPresentations = 0;
  for (const scenario of ['accordion-2', 'compact-accordion']) {
    const observation = job.tasks
      ?.flatMap((task) => task.observations)
      .find((value) => value.scenario === scenario);
    const quality = observation?.measurement?.quality;
    const finding = observation?.measurement?.findings.find(
      (value) =>
        value.type === 'GENERAL_FLASH' &&
        value.region.x === 200 &&
        value.region.y === 480 &&
        value.region.width === 4 &&
        value.region.height === 4,
    );
    const entry = {
      scenario,
      achieved: observation?.achieved ?? false,
      status: observation?.measurement?.status ?? null,
      frames: quality?.frameCount ?? 0,
      fps: quality?.effectiveFps ?? null,
      maximumGapMs: quality?.maxGapMs ?? null,
      interrupted: quality?.interrupted ?? null,
      sourceWidth: quality?.width ?? null,
      sourceHeight: quality?.height ?? null,
      worker: quality?.processing ?? null,
      limitations: observation?.measurement?.limitations ?? [],
      tinyCandidateObserved: Boolean(finding),
      adequateCapture: Boolean(
        quality &&
        !quality.downsampled &&
        !quality.interrupted &&
        quality.spatial?.retainedResolutionRatio === 1 &&
        quality.effectiveFps >= 50 &&
        quality.maxGapMs <= 100,
      ),
      maximumNativeGreyError: null,
    };
    measurements.push(entry);
    check(`${scenario}:capture-quality`, () => {
      assert.equal(observation?.achieved, true);
      assert.equal(entry.adequateCapture, true);
      assert.equal(observation.replay.viewport.dpr, 2);
    });
    check(`${scenario}:pixel-candidate-and-reference`, () => {
      assert.ok(finding, 'Expected the exact 4×4 native candidate.');
      const reference = finding.spatial.visualField;
      assert.equal(reference.basis, 'W3C_CSS_REFERENCE');
      assert.equal(reference.widthPx, 682);
      assert.equal(reference.heightPx, 512);
      assert.equal(reference.maximumPixels, 16);
      assert.equal(reference.maximumRatio, 16 / (682 * 512));
      assert.equal(reference.exceedsThreshold, false);
      assert.ok(
        !observation.measurement.limitations.some((value) =>
          value.startsWith('CSS_REFERENCE_'),
        ),
      );
      const samples = finding.diagnostic?.samples;
      assert.ok(samples?.length > 0, 'Retain real captured RGB evidence.');
      let maximumError = 0;
      const matchedColours = new Set();
      for (const sample of samples) {
        const alternatives = [35, 125]
          .map((grey) => ({
            grey,
            error: Math.max(
              Math.abs(sample.red - grey),
              Math.abs(sample.green - grey),
              Math.abs(sample.blue - grey),
            ),
          }))
          .sort((a, b) => a.error - b.error);
        maximumError = Math.max(maximumError, alternatives[0].error);
        matchedColours.add(alternatives[0].grey);
      }
      entry.maximumNativeGreyError = maximumError;
      assert.ok(
        maximumError <= 2,
        'Native RGB must match source greys within explicit 2/255 conversion tolerance.',
      );
      assert.deepEqual(
        [...matchedColours].sort((a, b) => a - b),
        [35, 125],
      );
    });
    check(`${scenario}:source-video`, () => {
      assert.equal(finding?.sourceTimeline.status, 'CORRELATED');
      assert.equal(finding.sourceTimeline.alignmentUncertaintyMs, null);
      const video = finding.sourceTimeline.candidates.find(
        (value) => value.tag === 'video' && value.media === 'VIDEO',
      );
      assert.ok(video);
      assert.ok(
        video.observations.some(
          (value) => value.mediaPaused === false && value.videoPresentation,
        ),
      );
      for (const sample of video.observations) {
        assert.deepEqual(sample.rect, { x: 100, y: 240, width: 2, height: 2 });
        const presentation = sample.videoPresentation;
        if (scenario !== 'compact-accordion' || !presentation) continue;
        // Only the final compact document is retained by the fixture collector.
        const actual = fixture.presentations.find(
          (value) => value.presentedFrames === presentation.presentedFrames,
        );
        if (!actual) continue;
        assert.equal(presentation.mediaTimeMs, actual.mediaTime * 1000);
        assert.equal(
          presentation.presentationEpochMs,
          actual.presentationEpochMs,
        );
        assert.equal(
          presentation.expectedDisplayEpochMs,
          actual.expectedDisplayEpochMs,
        );
        matchingCompactPresentations++;
      }
    });
  }
  check('compact-presentation-alignment', () => {
    assert.ok(matchingCompactPresentations >= 10);
  });
  return {
    status: errors.length ? 'FAIL' : 'PASS',
    scope:
      'One tiny pre-encoded lossless VP9/WebM presented by an actual HTML video in desktop and compact native captures. This is not broad codec, natural-video, colour-management or hardware validation.',
    scannerBuildSha256: job.scannerBuildSha256,
    extensionBuild: environment.extensionBuild,
    jobId: job.id,
    jobState: job.state,
    sourceSha256: assets.assets.signal.record.sha256,
    sourceManifestSha256: assets.manifestSha256,
    sourceDecoderProof: assets.manifest.verification,
    measurements,
    matchingCompactPresentations,
    alignment:
      'Final compact-document presentation metadata only. Source-to-DOM latency remains unknown; matching timestamps do not establish general causal attribution.',
    errors,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assert.ok(process.argv.length === 4 || process.argv.length === 5);
    const [job, environment, assets] = await Promise.all([
      readFile(process.argv[2], 'utf8').then(JSON.parse),
      readFile(process.argv[3], 'utf8').then(JSON.parse),
      loadNativeEncodedAssets(process.argv[4]),
    ]);
    const result = verifyNativeEncoded(job, environment, assets);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'PASS') process.exitCode = 2;
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          status: 'FAIL',
          errors: [
            {
              scope: 'input-or-source-validation',
              reason: String(error.message ?? error),
            },
          ],
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
  }
}
