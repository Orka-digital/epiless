// Usage: node tests/extension/verify-native-dense.mjs local-job.json environment.json [--require-wasm]
// Summarizes both adequate and inadequate runs; does not turn poor cadence into a pass.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const requireWasm = process.argv[4] === '--require-wasm';
assert.equal(process.argv.length, requireWasm ? 5 : 4);
const [job, environment] = await Promise.all(
  process.argv
    .slice(2, 4)
    .map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
);
const fixture = environment.candidateFixture;
assert.equal(fixture.dense, true);
assert.equal(fixture.video, true);
assert.equal(fixture.source, 'CANVAS_CAPTURE_STREAM');
assert.ok(
  !fixture.events.some((event) =>
    ['MEDIA_ERROR', 'RVFC_UNAVAILABLE'].includes(event.kind),
  ),
);
assert.equal(fixture.denseBackground.kind, 'WEBGL2_LOW_CONTRAST_RGB');
assert.deepEqual(fixture.denseBackground.errors, []);
assert.ok(
  fixture.denseBackground.draws.length >= 150,
  'Independently record the actual GPU draw cadence.',
);
assert.ok(
  environment.denseProbe?.samples.length > 0,
  'Actual tabCapture pixels must be probed.',
);
const observations = job.tasks.flatMap((task) => task.observations);
const measurements = [];
let matchedCompactPresentations = 0;
for (const scenario of ['accordion-2', 'compact-accordion']) {
  const observation = observations.find((value) => value.scenario === scenario);
  assert.ok(observation?.achieved && observation.measurement);
  const { quality, findings } = observation.measurement;
  assert.equal(quality.downsampled, false);
  assert.equal(quality.spatial.retainedResolutionRatio, 1);
  const start = Date.parse(observation.startedAt),
    end = Date.parse(observation.endedAt);
  const probes = environment.denseProbe.samples.filter(
    (sample) =>
      sample.receiptEpochMs >= start + 500 &&
      sample.receiptEpochMs <= end - 200 &&
      sample.width === quality.width &&
      sample.height === quality.height,
  );
  assert.ok(
    probes.length >= 2,
    'Need multiple actual captured dense-background samples.',
  );
  for (const sample of probes) {
    assert.equal(sample.colors.length, 4);
    for (const color of sample.colors) {
      assert.equal(color[3], 255);
      assert.ok(
        color.slice(0, 3).every((channel) => channel >= 89 && channel <= 114),
        'Captured corners must match the low-contrast shader range, allowing 1/255 conversion rounding.',
      );
    }
  }
  const distinct = new Set(
    probes.map((sample) => JSON.stringify(sample.colors)),
  );
  assert.ok(
    distinct.size > 1,
    'Capture must contain changing pixels, not a frozen or black surface.',
  );
  const tiny = findings.find(
    (finding) =>
      finding.type === 'GENERAL_FLASH' &&
      finding.region.x === 200 &&
      finding.region.y === 480 &&
      finding.region.width === 4 &&
      finding.region.height === 4,
  );
  const video = tiny?.sourceTimeline?.candidates.find(
    (candidate) => candidate.tag === 'video' && candidate.media === 'VIDEO',
  );
  if (requireWasm) {
    assert.ok(
      tiny && video,
      'The exact tiny candidate and video clue must survive.',
    );
    assert.equal(tiny.spatial.visualField.basis, 'W3C_CSS_REFERENCE');
    assert.equal(tiny.spatial.visualField.widthPx, 682);
    assert.equal(tiny.spatial.visualField.heightPx, 512);
    assert.equal(tiny.spatial.componentPixels, 16);
    assert.equal(
      quality.interrupted,
      false,
      'Overloaded capture cannot pass native WASM acceptance.',
    );
    assert.ok(quality.effectiveFps >= 50 && quality.maxGapMs <= 100);
    assert.equal(observation.measurement.status, 'NEEDS_REVIEW');
    const backend = quality.processing.analysisBackend;
    assert.equal(backend?.backend, 'WASM_DENSE');
    assert.equal(backend.selectionReason, 'READY');
    assert.ok(
      backend.denseFrames >= 150 && backend.denseFrames <= quality.frameCount,
    );
    assert.equal(
      backend.inputCopiedBytes,
      0,
      'Native input must reach the kernel without an extra full-frame copy.',
    );
    assert.equal(backend.engineStateBytes, quality.spatial.stateBytes);
    assert.equal(quality.processing.measuredFrames, quality.frameCount);
  }
  if (scenario === 'compact-accordion') {
    for (const sample of video?.observations ?? []) {
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
      matchedCompactPresentations++;
    }
  }
  measurements.push({
    scenario,
    status: observation.measurement.status,
    frames: quality.frameCount,
    fps: quality.effectiveFps,
    maximumGapMs: quality.maxGapMs,
    interrupted: quality.interrupted,
    sourceWidth: quality.width,
    sourceHeight: quality.height,
    worker: quality.processing,
    limitations: observation.measurement.limitations,
    tinyCandidateObserved: !!tiny,
    videoSourceCandidateRetained: !!video,
    referenceBasis: tiny?.spatial?.visualField?.basis ?? null,
    capturedBackgroundProbes: probes.length,
    distinctCapturedBackgroundSamples: distinct.size,
    adequateCapture:
      !quality.interrupted &&
      quality.effectiveFps >= 50 &&
      quality.maxGapMs <= 100,
  });
}
const draws = fixture.denseBackground.draws;
if (requireWasm) assert.ok(matchedCompactPresentations >= 10);
const gaps = draws.slice(1).map((draw, index) => draw.at - draws[index].at);
console.log(
  JSON.stringify(
    {
      scope:
        'One instrumented native 2x2 CSS-pixel video candidate over a five-second low-contrast GPU RGB workload, at desktop and compact geometry on one machine. Not natural-video or cross-machine validation.',
      scannerBuildSha256: job.scannerBuildSha256,
      acceptance: requireWasm
        ? 'NATIVE_DENSE_WASM_FIXTURE_PASSED'
        : 'MEASUREMENT_ONLY',
      jobId: job.id,
      jobState: job.state,
      instrumentation: environment.denseProbe.instrumentation,
      measurements,
      matchingCompactPresentations: matchedCompactPresentations,
      compactProducer: {
        draws: draws.length,
        fps: ((draws.length - 1) * 1000) / (draws.at(-1).at - draws[0].at),
        maxGapMs: Math.max(...gaps),
        scope:
          'Final compact document only; main-thread draw submission, not proof of display or capture latency.',
      },
      bothCaptureProfilesAdequate: measurements.every(
        (value) => value.adequateCapture,
      ),
    },
    null,
    2,
  ),
);
