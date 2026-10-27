import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareAlternatingBaseline,
  verifyAlternatingFirstEncounter,
} from '../../scripts/validate-alternating-regression.mjs';

test('the immutable first encounter remains a separate c216 checkpoint', async () => {
  const baseline = await verifyAlternatingFirstEncounter();
  assert.equal(
    baseline.engineTreeSha256,
    'c216fbe2c9de76354061c35ba4df09e7e0a25731e5be247f3a7092aca2ca687a',
  );
  assert.equal(
    compareAlternatingBaseline(baseline.cases, baseline).status,
    'NO_NEW_MISMATCHES',
  );
});

test('changed case coverage, labels, decoded bytes or timestamps are rejected rather than normalized', async () => {
  const baseline = await verifyAlternatingFirstEncounter();
  assert.throws(
    () => compareAlternatingBaseline(baseline.cases.slice(1), baseline),
    /selection changed/,
  );
  const duplicate = structuredClone(baseline.cases);
  duplicate[1] = duplicate[0];
  assert.throws(
    () => compareAlternatingBaseline(duplicate, baseline),
    /Duplicate/,
  );
  for (const [field, value] of [
    ['jsonExpectedCandidate', !baseline.cases[0].jsonExpectedCandidate],
    ['frameCount', 1],
    ['generatedFrameSha256', ['changed']],
    ['decodedFrameSha256', ['changed']],
    ['decodedFrameTimestampMs', [100]],
  ]) {
    const changed = structuredClone(baseline.cases);
    changed[0][field] = value;
    assert.throws(
      () => compareAlternatingBaseline(changed, baseline),
      /Frozen/,
    );
  }
});

test('a new case-level mismatch fails both label comparisons while preserving exact decoded evidence', async () => {
  const baseline = await verifyAlternatingFirstEncounter(),
    current = structuredClone(baseline.cases);
  current[0].observedCandidate = !current[0].observedCandidate;
  const result = compareAlternatingBaseline(current, baseline);
  assert.equal(result.status, 'REGRESSION');
  assert.equal(result.newMismatches.length, 2);
  assert.deepEqual(result.knownMismatches, []);
});
