import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

import { readFile } from 'node:fs/promises';

import { resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { FROZEN_MANIFEST_SHA256 } from './validate-alternating-heldout.mjs';

const root = fileURLToPath(
  new URL('../tests/reference/trace-alternating-heldout/', import.meta.url),
);

const hash = (/** @type {import("node:crypto").BinaryLike} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');

export const FIRST_ENCOUNTER_SHA256 =
  'd7e80663cd062b14edb1ec5d72de9f0e249f9ab904979e9715ffc976250e9b74';

export async function verifyAlternatingFirstEncounter() {
  const bytes = await readFile(resolve(root, 'first-encounter-0.4.0.json'));
  assert.equal(
    hash(bytes),
    FIRST_ENCOUNTER_SHA256,
    'Original first encounter must remain unchanged',
  );
  /** @type {{cases:import("./helper-types.js").VideoCase[], scope:string, engineTreeSha256:string, reference:{manifestSha256:string}, scoredInputs:number, scopeLimitations:string[], unscored:unknown[], totalDecodedFrames:number}} */
  const baseline = JSON.parse(bytes.toString());
  assert.equal(baseline.reference.manifestSha256, FROZEN_MANIFEST_SHA256);
  assert.equal(baseline.scoredInputs, 16);
  assert.deepEqual(baseline.unscored, []);
  assert.equal(baseline.totalDecodedFrames, 544);
  return baseline;
}

/** Case identity, source frames, PTS and both independent labels remain fixed. */
/**
 * @param {import("./helper-types.js").VideoCase[]} current
 * @param {{cases: import("./helper-types.js").VideoCase[]}} baseline
 */
export function compareAlternatingBaseline(current, baseline) {
  assert.equal(current.length, baseline.cases.length, 'Case selection changed');
  assert.equal(
    new Set(current.map((c) => c.id)).size,
    current.length,
    'Duplicate case',
  );
  const prior = new Map(baseline.cases.map((c) => [c.id, c]));
  const knownMismatches = [],
    newMismatches = [],
    improvements = [];
  for (const item of current) {
    const old = prior.get(item.id);
    assert.ok(old, 'Unknown case identity');
    for (const key of /** @type {const} */ ([
      'jsonExpectedCandidate',
      'csvExpectedCandidate',
      'frameCount',
      'frameRate',
      'width',
      'height',
    ]))
      assert.equal(
        item[key],
        old[key],
        `Frozen label or geometry changed: ${key}`,
      );
    for (const key of /** @type {const} */ ([
      'generatedFrameSha256',
      'decodedFrameSha256',
      'decodedFrameTimestampMs',
    ]))
      assert.deepEqual(
        item[key],
        old[key],
        `Frozen decoded evidence changed: ${key}`,
      );
    assert.equal(typeof item.observedCandidate, 'boolean');
    for (const label of /** @type {const} */ ([
      'jsonExpectedCandidate',
      'csvExpectedCandidate',
    ])) {
      if (item[label] === null) continue;
      const wasMismatch = old[label] !== old.observedCandidate,
        isMismatch = item[label] !== item.observedCandidate;
      const id = `${label}:${item.id}`;
      if (wasMismatch && isMismatch) knownMismatches.push(id);
      else if (isMismatch) newMismatches.push(id);
      else if (wasMismatch) improvements.push(id);
    }
  }
  return {
    status: newMismatches.length ? 'REGRESSION' : 'NO_NEW_MISMATCHES',
    knownMismatches,
    newMismatches,
    improvements,
  };
}
