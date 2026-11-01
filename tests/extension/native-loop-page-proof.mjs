// Pure retained-evidence verification; no browser, capture or media generation.
// node --import tsx tests/extension/verify-native-loop.mjs local-job.json report.json environment.json [asset-directory]
import assert from 'node:assert/strict';

import { independentWraps } from './native-loop-provenance.mjs';

/** Cross-check observer media samples against independently recorded page clocks and compositor callbacks. */
export function verifyIndependentLoop(observation, environment, source) {
  const evidence = observation.mediaEvidence,
    item = evidence.items[0];
  const within = (sample) =>
    sample.atEpochMs >= evidence.startedEpochMs &&
    sample.atEpochMs <= evidence.endedEpochMs;
  const documents = environment.loopDocuments.filter((document) =>
    document.samples.some(within),
  );
  assert.equal(
    documents.length,
    1,
    'Independent document clocks must identify one measured page.',
  );
  const document = documents[0];
  assert.equal(document.sourceSha256, source.sourceSha256);
  assert.deepEqual(document.limitations, []);
  assert.ok(document.documentStartedEpochMs <= evidence.startedEpochMs);
  assert.ok(
    !document.events.some((event) =>
      ['ERROR', 'RVFC_UNAVAILABLE'].includes(event.kind),
    ),
  );
  const samples = document.samples.filter(within),
    presentations = document.presentations.filter(within);
  assert.ok(samples.length >= 40 && presentations.length >= 50);
  assert.ok(
    samples.every(
      (sample) =>
        sample.loop &&
        sample.playbackRate === 1 &&
        sample.rect.width === 64 &&
        sample.rect.height === 64,
    ),
  );
  const currentTimeWraps = independentWraps(samples, source.durationMs, 1);
  const presentedWraps = independentWraps(presentations, source.durationMs, 1);
  assert.ok(currentTimeWraps >= 1 && presentedWraps >= 1);
  for (const presentation of presentations) {
    assert.equal(presentation.videoWidth, 2);
    assert.equal(presentation.videoHeight, 2);
    const frame =
      source.frames[Math.round(presentation.timeMs / source.frameDurationMs)];
    assert.ok(
      frame && Math.abs(frame.timestampMs - presentation.timeMs) < 0.1,
      'Actual rVFC media positions must correspond to the immutable encoded frame timestamps.',
    );
  }
  let matchedPresentations = 0;
  for (const sample of item.samples) {
    if (!sample.presentation) continue;
    const atEpochMs = evidence.startedEpochMs + sample.atMs;
    assert.ok(
      presentations.some(
        (presented) =>
          Math.abs(presented.timeMs - sample.presentation.timeMs) < 0.1 &&
          presented.atEpochMs <= atEpochMs + 50 &&
          atEpochMs - presented.atEpochMs <= 250,
      ),
      'Observer presentation metadata must match an independently recorded page callback near that sample.',
    );
    matchedPresentations++;
  }
  assert.ok(matchedPresentations >= 40);
  return {
    documentId: document.documentId,
    currentTimeSamples: samples.length,
    presentations: presentations.length,
    currentTimeWraps,
    presentedWraps,
    matchedPresentations,
  };
}
