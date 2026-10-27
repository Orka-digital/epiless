import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  compareExpandedBaseline,
  validateExpanded,
} from '../../scripts/validate-expanded.mjs';
import { parseSamples } from '../../scripts/validate-detection.mjs';

test('zero-based sources are explicit and non-contiguous labels are rejected', () => {
  const source = 'sRGBA,r,g,b,a\n0,1,2,3,255\n1,4,5,6,255\n';
  assert.throws(() => parseSamples(source), /Invalid reference/);
  assert.equal(parseSamples(source, { allowZeroBased: true }).length, 2);
  assert.throws(
    () =>
      parseSamples(source.replace('1,4,5,6', '3,4,5,6'), {
        allowZeroBased: true,
      }),
    /Invalid reference/,
  );
});
test('expanded comparison keeps every source case and blocks hidden unscored cases', async () => {
  const report = await validateExpanded();
  const baseline = JSON.parse(
    await readFile(
      new URL(
        './trace-pse-expanded/first-encounter-0.4.0.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(report.sourceCases, 400);
  assert.equal(report.cases.length + report.unscored.length, 400);
  assert.deepEqual(
    report.unscored.map((value) => value.id),
    [
      'lum_flash_patterns/rel_lum/ff004_srgba.csv',
      'lum_flash_patterns/rel_lum/ff005_srgba.csv',
    ],
  );
  assert.equal(
    compareExpandedBaseline(report, baseline).status,
    'NO_NEW_MISMATCHES',
  );
  const hidden = structuredClone(report);
  hidden.unscored.pop();
  assert.throws(() => compareExpandedBaseline(hidden, baseline), /coverage/);
  const removed = structuredClone(report);
  removed.cases.pop();
  assert.throws(() => compareExpandedBaseline(removed, baseline), /case set/);
});
