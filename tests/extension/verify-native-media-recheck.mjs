import { verifyMediaRecheckMeasurement } from './native-recheck-measurement-proof.mjs';
// Genuine native exports only. This explicit video variant does not change the
// original CSS recheck verifier or the product comparison requirements.
// Usage: node --import tsx tests/extension/verify-native-media-recheck.mjs \
//   baseline-job baseline-env fixed-job fixed-env recurrence-job recurrence-env
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';

import { pathToFileURL } from 'node:url';

import { compareVerification } from '../../apps/chrome-extension/src/verification.ts';

import { mediaComparisonReasons } from '../../apps/chrome-extension/src/media-replay.ts';

import { phaseComparisonReasons } from '../../apps/chrome-extension/src/animation-phase.ts';

import { loadNativeEncodedAssets } from './native-encoded-source.mjs';

import { verifyRecheckOrder } from './native-recheck-provenance.mjs';

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
    verifyMediaRecheckMeasurement({
      environments,
      index,
      assets,
      job,
      baseline,
      original,
      measurements,
      independentDocuments,
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
export {
  verifyMeasuredMediaEvents,
  verifyRecheckOrder,
  verifyRecheckProvenance,
} from './native-recheck-provenance.mjs';
