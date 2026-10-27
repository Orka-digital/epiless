import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareBaseline,
  parseSamples,
  summarizeCases,
  validateDetection,
} from '../../scripts/validate-detection.mjs';

const references = fileURLToPath(new URL('./trace-pse/', import.meta.url));

const baselineExample = () => ({
  scope: 'NUMERIC_TEMPORAL_INTENSITY_PROJECTION',
  engineVersion: 'previous',
  engineSourceSha256: 'a'.repeat(64),
  reference: {
    repository: 'https://example.test/reference',
    commit: 'a'.repeat(40),
    manifestSha256: 'b'.repeat(64),
  },
  cases: [
    {
      id: 'known-false-positive',
      kind: 'GENERAL_FLASH',
      expectedCandidate: false,
      observedCandidate: true,
    },
    {
      id: 'correct-positive',
      kind: 'RED_FLASH',
      expectedCandidate: true,
      observedCandidate: true,
    },
    {
      id: 'correct-negative',
      kind: 'GENERAL_FLASH',
      expectedCandidate: false,
      observedCandidate: false,
    },
  ],
});

test('baseline permits known disagreements and improvements across engine versions', () => {
  const baseline = baselineExample();
  const current = structuredClone(baseline);
  current.engineVersion = 'next';
  current.engineSourceSha256 = 'c'.repeat(64);
  const unchanged = compareBaseline(current, baseline);
  assert.equal(unchanged.status, 'NO_NEW_MISMATCHES');
  assert.deepEqual(unchanged.knownMismatches, ['known-false-positive']);
  assert.deepEqual(unchanged.newMismatches, []);
  current.cases[0].observedCandidate = false;
  const improved = compareBaseline(current, baseline);
  assert.equal(improved.status, 'NO_NEW_MISMATCHES');
  assert.deepEqual(improved.knownMismatches, []);
  assert.deepEqual(improved.improvements, ['known-false-positive']);
});

test('baseline detects new misses or extra candidates even when another case improves', () => {
  const baseline = baselineExample();
  const current = structuredClone(baseline);
  current.cases[0].observedCandidate = false;
  current.cases[1].observedCandidate = false;
  // Same total mismatch count as before, but it is now a newly missed positive.
  current.cases[1].agreement = true;
  const regression = compareBaseline(current, baseline);
  assert.equal(regression.status, 'REGRESSION');
  assert.deepEqual(regression.newMismatches, ['correct-positive']);
  assert.deepEqual(regression.improvements, ['known-false-positive']);
  current.cases[2].observedCandidate = true;
  assert.deepEqual(compareBaseline(current, baseline).newMismatches, [
    'correct-negative',
    'correct-positive',
  ]);
});

test('baseline rejects corpus drift, missing or duplicate cases and changed expected labels', () => {
  const baseline = baselineExample();
  for (const change of [
    (report) => {
      report.reference.manifestSha256 = 'c'.repeat(64);
    },
    (report) => {
      report.cases.pop();
    },
    (report) => {
      report.cases[1].id = report.cases[0].id;
    },
    (report) => {
      report.cases[1].kind = 'GENERAL_FLASH';
    },
    (report) => {
      report.cases[1].expectedCandidate = false;
    },
  ]) {
    const current = structuredClone(baseline);
    change(current);
    assert.throws(() => compareBaseline(current, baseline), /baseline/i);
  }
});

test('external frames preserve values and reject corrupted row order or channels', () => {
  assert.deepEqual(
    parseSamples('sRGBA,r,g,b,a\n1,0,4,255,255\n2,12,9,8,255\n'),
    [new Uint8Array([0, 4, 255, 255]), new Uint8Array([12, 9, 8, 255])],
  );
  for (const bad of [
    'r,g,b,a\n1,0,4,255,255\n2,12,9,8,255',
    'sRGBA,r,g,b,a\n1,0,4,255,255\n1,12,9,8,255',
    'sRGBA,r,g,b,a\n1,0,4,255,255\n2,256,9,8,255',
    'sRGBA,r,g,b,a\n1,0,4,255,255\n2,12,NaN,8,255',
  ])
    assert.throws(() => parseSamples(bad));
});

test('comparison separates false negatives, false positives and unsupported empty rates', () => {
  const cases = [
    { expectedCandidate: true, observedCandidate: true },
    { expectedCandidate: true, observedCandidate: false },
    { expectedCandidate: false, observedCandidate: true },
    { expectedCandidate: false, observedCandidate: false },
  ];
  assert.deepEqual(summarizeCases(cases), {
    cases: 4,
    truePositive: 1,
    falseNegative: 1,
    falsePositive: 1,
    trueNegative: 1,
    sensitivityOnSelectedCases: 0.5,
    precisionOnSelectedCases: 0.5,
    specificityOnSelectedCases: 0.5,
    mismatches: 2,
  });
  assert.equal(summarizeCases([]).sensitivityOnSelectedCases, null);
});

test('pinned external comparison retains all positive and negative cases without conformance claims', async () => {
  const report = await validateDetection();
  assert.equal(report.reference.filesVerified, 45);
  assert.equal(report.cases.length, 42);
  assert.equal(
    report.cases.filter((item) => item.expectedCandidate).length,
    11,
  );
  assert.equal(report.conformanceEstablished, false);
  assert.equal(report.scope, 'NUMERIC_TEMPORAL_INTENSITY_PROJECTION');
  assert.match(report.engineSourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    report.overall.mismatches,
    report.cases.filter((item) => !item.agreement).length,
  );
});

test('changed bytes, relabelled expected results and escaping paths fail before metrics', async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'epiless-reference-integrity-'),
  );
  try {
    await cp(references, temporary, { recursive: true });
    const manifestPath = join(temporary, 'manifest.json');
    const original = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(original);
    const positive = manifest.files.find(
      (item) => item.expectedCandidate === true,
    );
    const samplePath = join(temporary, 'upstream', positive.path);
    const bytes = await readFile(samplePath);
    await writeFile(samplePath, Buffer.concat([bytes, Buffer.from('\n')]));
    await assert.rejects(validateDetection(temporary), /integrity mismatch/);
    await writeFile(samplePath, bytes);
    positive.expectedCandidate = false;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      validateDetection(temporary),
      /Invalid reference case/,
    );
    manifest.files[0].path = '../outside.txt';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      validateDetection(temporary),
      /Invalid or duplicate reference path/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
