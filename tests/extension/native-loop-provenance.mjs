// Pure retained-evidence verification; no browser, capture or media generation.
// node --import tsx tests/extension/verify-native-loop.mjs local-job.json report.json environment.json [asset-directory]
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';

import { sha256 } from './native-encoded-source.mjs';

import { nativeLoopPage } from './native-loop-page.mjs';

import {
  LOOP_CADENCE_POLICY,
  nativeLoopCadencePage,
} from './native-loop-cadence-page.mjs';

const expectedPageModuleSha256 = sha256(
  await readFile(new URL('./native-loop-page.mjs', import.meta.url)),
);

const expectedCadenceModuleSha256 = sha256(
  await readFile(new URL('./native-loop-cadence-page.mjs', import.meta.url)),
);

export function verifyLoopFixtureIdentity(identity, source) {
  assert.equal(identity.source, 'EXISTING_FIXED_VP9_LOOP');
  assert.equal(
    identity.pageModuleSha256,
    expectedPageModuleSha256,
    'The retained page trace must identify this exact original fixture module.',
  );
  if (identity.cadenceVariant !== undefined) {
    assert.deepEqual(Object.keys(identity.cadenceVariant).sort(), [
      'moduleSha256',
      'policy',
    ]);
    assert.equal(
      identity.cadenceVariant.moduleSha256,
      expectedCadenceModuleSha256,
    );
    assert.deepEqual(identity.cadenceVariant.policy, LOOP_CADENCE_POLICY);
  }
  assert.equal(
    identity.servedHtmlSha256,
    sha256(
      identity.cadenceVariant === undefined
        ? nativeLoopPage(source)
        : nativeLoopCadencePage(source),
    ),
  );
}

/** Count only genuine end→start clock wraps, not arbitrary backwards seeks. */
export function independentWraps(samples, durationMs, rate) {
  assert.ok(Number.isFinite(rate) && rate > 0);
  assert.ok(Number.isFinite(durationMs) && durationMs > 500 * rate);
  assert.ok(
    samples.every(
      (sample) =>
        Number.isFinite(sample.atEpochMs) &&
        Number.isFinite(sample.timeMs) &&
        sample.timeMs >= 0 &&
        sample.timeMs <= durationMs + 2,
    ),
  );
  let wraps = 0;
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1],
      current = samples[i];
    assert.ok(current.atEpochMs >= previous.atEpochMs);
    assert.ok(
      current.atEpochMs - previous.atEpochMs <= 250,
      'Independent trace has a sampling gap.',
    );
    let advance = current.timeMs - previous.timeMs;
    if (current.timeMs + 2 < previous.timeMs) {
      assert.ok(
        previous.timeMs >= durationMs - 250 * rate &&
          current.timeMs <= 250 * rate,
        'A backwards seek away from the boundary is not a loop wrap.',
      );
      wraps++;
      advance += durationMs;
    }
    assert.ok(
      advance <= (current.atEpochMs - previous.atEpochMs) * rate + 80,
      'Independent trace skipped media positions; a large seek is not playback.',
    );
  }
  return wraps;
}
