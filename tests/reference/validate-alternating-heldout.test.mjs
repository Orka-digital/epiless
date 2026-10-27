import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  validateAlternatingContract,
  verifyAlternatingCorpus,
  verifyAlternatingFile,
} from '../../scripts/validate-alternating-heldout.mjs';
import {
  safeReferencePath,
  verifyDecodedFrames,
  verifyFrameTimes,
} from '../../scripts/validate-spatial-media.mjs';

const corpus = new URL('./trace-alternating-heldout/', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('all 16 frozen new compositions retain known temporal overlap and original provenance', async () => {
  const { manifest, files } = await verifyAlternatingCorpus();
  assert.equal(files.size, 46);
  assert.equal(manifest.videos.length, 16);
  assert.equal(manifest.counts.temporalSourcesWithPreviousBytes, 12);
  assert.equal(manifest.counts.spatialSourcesWithPreviousBytes, 0);
});

test('exclusions, duplicated cases, label changes and dependency substitutions fail before analysis', async () => {
  const { manifest, files } = await verifyAlternatingCorpus();
  const omitted = structuredClone(manifest);
  omitted.videos.pop();
  assert.throws(() => validateAlternatingContract(omitted, files), /All 16/);
  const duplicated = structuredClone(manifest);
  duplicated.videos[1] = duplicated.videos[0];
  assert.throws(() => validateAlternatingContract(duplicated, files), /All 16/);
  const relabelled = structuredClone(manifest);
  relabelled.videos[0].upstreamCsvPass = 'FALSE';
  assert.throws(
    () => validateAlternatingContract(relabelled, files),
    /Original CSV/,
  );
  const jsonRelabelled = structuredClone(manifest);
  jsonRelabelled.videos[0].expectedWcagClassic = 'fail';
  assert.throws(
    () => validateAlternatingContract(jsonRelabelled, files),
    /Original JSON/,
  );
  const dependency = structuredClone(manifest);
  dependency.videos[0].dependencies.spatial =
    dependency.videos[2].dependencies.spatial;
  assert.throws(
    () => validateAlternatingContract(dependency, files),
    /Dependency identity/,
  );
  const missing = new Map(files);
  missing.delete(manifest.videos[0].dependencies.temporal_color);
  assert.throws(
    () => validateAlternatingContract(manifest, missing),
    /Dependency missing/,
  );
  assert.throws(() => safeReferencePath('/corpus', '../escape'), /escapes/);
});

test('reference truncation and single-byte corruption fail independently of expected labels', async () => {
  const { manifest } = await verifyAlternatingCorpus();
  const item = manifest.files.find((f) => f.path.endsWith('f001c037.json'));
  const bytes = await readFile(new URL('upstream/' + item.path, corpus));
  assert.throws(
    () => verifyAlternatingFile(item, bytes.subarray(1)),
    /length mismatch/,
  );
  const changed = Buffer.from(bytes);
  changed[0] ^= 1;
  assert.throws(() => verifyAlternatingFile(item, changed), /SHA-256 mismatch/);
});

test('every decoded frame and PTS must be complete and exact before accepting media', async () => {
  const first = Buffer.from([1, 2, 3, 255]),
    second = Buffer.from([4, 5, 6, 255]);
  const expected = [hash(first), hash(second)],
    accepted = [];
  async function* chunks(bytes) {
    yield bytes.subarray(0, 3);
    yield bytes.subarray(3);
  }
  assert.deepEqual(
    await verifyDecodedFrames(
      chunks(Buffer.concat([first, second])),
      4,
      expected,
      (frame, i) => accepted.push({ i, bytes: [...frame] }),
    ),
    expected,
  );
  assert.deepEqual(accepted, [
    { i: 0, bytes: [...first] },
    { i: 1, bytes: [...second] },
  ]);
  await assert.rejects(
    verifyDecodedFrames(
      chunks(Buffer.concat([first, second.subarray(0, 3)])),
      4,
      expected,
      () => {},
    ),
    /Truncated/,
  );
  await assert.rejects(
    verifyDecodedFrames(
      chunks(Buffer.concat([first, first])),
      4,
      expected,
      () => {},
    ),
    /hash mismatch/,
  );
  const probe = {
    streams: [
      { codec_name: 'ffv1', width: 1920, height: 1080, r_frame_rate: '30/1' },
    ],
    frames: [
      { best_effort_timestamp_time: '0.000000' },
      { best_effort_timestamp_time: '0.033333' },
    ],
  };
  assert.deepEqual(verifyFrameTimes(probe, 2, 30), [0, 33.333]);
  probe.frames[1].best_effort_timestamp_time = '0.066667';
  assert.throws(() => verifyFrameTimes(probe, 2, 30), /timestamp mismatch/);
});
