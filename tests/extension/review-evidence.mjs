import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
/** Load and cross-check immutable native review fixtures without modifying their history. */
export async function loadReviewEvidence() {
  const sourceDirectory = new URL('./evidence/', import.meta.url);
  const names = [
    'scanner-v04-native-detail-local-job.json',
    'scanner-v04-native-fixed-local-job.json',
    'scanner-v04-native-recurrence-local-job.json',
    'scanner-v04-native-review-verification.json',
  ];
  const sourceFiles = await Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(new URL(name, sourceDirectory));
      return {
        name,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        value: JSON.parse(bytes),
      };
    }),
  );
  const [baseline, fixed, recurrence, originalReviews] = sourceFiles.map(
    (entry) => entry.value,
  );
  assert.equal(baseline.reviews?.length ?? 0, 0);
  assert.equal(originalReviews.jobId, baseline.id);
  assert.equal(originalReviews.scannerBuildSha256, baseline.scannerBuildSha256);
  assert.equal(fixed.scannerBuildSha256, baseline.scannerBuildSha256);
  assert.equal(recurrence.scannerBuildSha256, baseline.scannerBuildSha256);
  const prefix = originalReviews.reviews.slice(0, 2);
  assert.deepEqual(
    prefix.map((entry) => entry.decision),
    ['CONFIRMED', 'RESOLVED'],
  );
  assert.equal(prefix[1].verificationJobId, fixed.id);
  assert.ok(Date.parse(recurrence.startedAt) > Date.parse(prefix[1].at));
  const anchor = {
    taskId: prefix[0].taskId,
    observationId: prefix[0].observationId,
    findingId: prefix[0].findingId,
  };
  assert.ok(
    prefix.every((entry) =>
      Object.entries(anchor).every(([key, value]) => entry[key] === value),
    ),
  );
  const sourceObservation = baseline.tasks
    .find((task) => task.id === anchor.taskId)
    ?.observations.find(
      (observation) => observation.id === anchor.observationId,
    );
  assert.ok(
    sourceObservation?.measurement.findings.some(
      (finding) => finding.id === anchor.findingId,
    ),
  );
  return {
    sourceFiles,
    baseline,
    fixed,
    recurrence,
    originalReviews,
    prefix,
    anchor,
    sourceObservation,
  };
}
