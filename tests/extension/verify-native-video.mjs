// Usage: node tests/extension/verify-native-video.mjs local-job.json environment.json [--css-reference]
// Validates actual native video evidence against independent page-side rVFC records.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cssReference = process.argv[4] === '--css-reference';
assert.equal(
  process.argv.length,
  cssReference ? 5 : 4,
  'Provide local job and environment exports, optionally --css-reference.',
);
const [job, environment] = await Promise.all(
  process.argv
    .slice(2, 4)
    .map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
);
const fixture = environment.candidateFixture;
assert.equal(fixture.video, true);
assert.equal(fixture.source, 'CANVAS_CAPTURE_STREAM');
assert.ok(
  !fixture.events.some((event) =>
    ['MEDIA_ERROR', 'RVFC_UNAVAILABLE'].includes(event.kind),
  ),
);
assert.ok(fixture.samples.some((sample) => sample.grey === 35));
assert.ok(fixture.samples.some((sample) => sample.grey === 125));
const observations = job.tasks.flatMap((task) => task.observations);
const measurements = [];
let matchedPresentations = 0;
for (const scenario of ['accordion-2', 'compact-accordion']) {
  const observation = observations.find((value) => value.scenario === scenario);
  assert.ok(observation?.achieved);
  const { quality, findings } = observation.measurement;
  assert.equal(quality.downsampled, false);
  assert.equal(quality.interrupted, false);
  assert.equal(quality.spatial.retainedResolutionRatio, 1);
  assert.ok(quality.effectiveFps >= 50 && quality.maxGapMs <= 100);
  const finding = findings.find((value) => value.type === 'GENERAL_FLASH');
  assert.deepEqual(finding?.region, { x: 200, y: 480, width: 4, height: 4 });
  assert.equal(
    finding.spatial.visualField.basis,
    cssReference ? 'W3C_CSS_REFERENCE' : 'W3C_1024_768_REFERENCE',
  );
  const dpr = cssReference ? observation.replay?.viewport.dpr : 1;
  assert.ok(Number.isFinite(dpr) && dpr > 0);
  assert.equal(finding.spatial.visualField.widthPx, Math.round(341 * dpr));
  assert.equal(finding.spatial.visualField.heightPx, Math.round(256 * dpr));
  assert.equal(
    finding.spatial.visualField.maximumRatio,
    16 / (Math.round(341 * dpr) * Math.round(256 * dpr)),
  );
  if (cssReference) {
    assert.ok(
      !observation.measurement.limitations.some((reason) =>
        reason.startsWith('CSS_REFERENCE_'),
      ),
    );
    assert.match(
      finding.spatial.visualField.reference,
      /CSS pixels at standard browser zoom/,
    );
  }
  assert.equal(finding.spatial.visualField.maximumPixels, 16);
  assert.equal(finding.spatial.visualField.exceedsThreshold, false);
  assert.equal(finding.sourceTimeline.status, 'CORRELATED');
  assert.equal(finding.sourceTimeline.alignmentUncertaintyMs, null);
  const video = finding.sourceTimeline.candidates.find(
    (candidate) => candidate.tag === 'video' && candidate.media === 'VIDEO',
  );
  assert.ok(
    video,
    'The actual video element must be retained as a source candidate.',
  );
  assert.ok(
    video.observations.every(
      (sample) =>
        sample.rect.x === 100 &&
        sample.rect.y === 240 &&
        sample.rect.width === 2 &&
        sample.rect.height === 2,
    ),
  );
  assert.ok(
    video.observations.some(
      (sample) => sample.mediaPaused === false && sample.videoPresentation,
    ),
  );
  if (scenario === 'compact-accordion') {
    // Compact navigation creates a fresh document. The final environment holds
    // that document's ground truth, not the earlier desktop document's records.
    for (const sample of video.observations) {
      const presentation = sample.videoPresentation;
      if (!presentation) continue;
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
      matchedPresentations++;
    }
  }
  measurements.push({
    scenario,
    frames: quality.frameCount,
    fps: quality.effectiveFps,
    maximumGapMs: quality.maxGapMs,
    sourceWidth: quality.width,
    sourceHeight: quality.height,
    workerMeanMs: quality.processing.meanMs,
    workerMaxMs: quality.processing.maxMs,
    referenceBasis: finding.spatial.visualField.basis,
    referenceWidthPx: finding.spatial.visualField.widthPx,
    referenceHeightPx: finding.spatial.visualField.heightPx,
  });
}
assert.ok(
  matchedPresentations >= 10,
  'Need multiple actual matching video presentation records.',
);
console.log(
  JSON.stringify(
    {
      scope:
        'One real native 2x2 CSS-pixel HTML video from a detached canvas stream, at desktop and compact geometry; not encoded-file playback or broad video validation.',
      scannerBuildSha256: job.scannerBuildSha256,
      jobId: job.id,
      jobState: job.state,
      measurements,
      matchingCompactPresentations: matchedPresentations,
      referenceArea:
        'Candidate retained below the fixed reference threshold; actual physical viewing geometry remains unknown.',
      alignment:
        'Per-video presentation records agree exactly. Source-frame-to-DOM latency remains unknown; correlation is not a general causal attribution guarantee.',
    },
    null,
    2,
  ),
);
