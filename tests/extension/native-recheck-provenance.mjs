// Genuine native exports only. This explicit video variant does not change the
// original CSS recheck verifier or the product comparison requirements.
// Usage: node --import tsx tests/extension/verify-native-media-recheck.mjs \
//   baseline-job baseline-env fixed-job fixed-env recurrence-job recurrence-env
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { sha256 } from './native-encoded-source.mjs';

import {
  encodedRecheckHtml,
  recheckMediaPath,
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
