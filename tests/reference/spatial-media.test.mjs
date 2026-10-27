import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifySpatialCorpus,
  sourceFrame,
  verifyDecodedFrames,
  verifyFrameTimes,
  compareSpatialBaseline,
  decodePngAlpha,
} from '../../scripts/validate-spatial-media.mjs';

const root = fileURLToPath(new URL('./trace-spatial/', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function temporaryCorpus(run) {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'epiless-spatial-reference-'),
  );
  try {
    await cp(root, directory, { recursive: true });
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test('all original masks, video configurations, dependencies and both label sources are integrity verified', async () => {
  const corpus = await verifySpatialCorpus(root);
  assert.equal(corpus.manifest.masks.length, 24);
  assert.equal(corpus.manifest.videos.length, 36);
  assert.ok(corpus.manifest.videos.some((v) => v.expectedWcagClassic === 's'));
  assert.ok(
    corpus.manifest.videos.some(
      (v) => v.expectedWcagClassic === 'pass' && v.csvExpected,
    ),
  );
});
test('changed bytes and relabelled manifest outcomes fail closed', async () => {
  await temporaryCorpus(async (directory) => {
    const file = resolve(directory, 'upstream/LICENSE');
    await writeFile(file, `${await readFile(file, 'utf8')}tampered`);
    await assert.rejects(verifySpatialCorpus(directory), /hash mismatch/);
  });
  await temporaryCorpus(async (directory) => {
    const file = resolve(directory, 'manifest.json'),
      manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.videos[0].expectedWcagClassic = 'fail';
    await writeFile(file, JSON.stringify(manifest));
    await assert.rejects(verifySpatialCorpus(directory), /label differs/);
  });
  await temporaryCorpus(async (directory) => {
    const file = resolve(directory, 'manifest.json'),
      manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.masks[0].expectedAboveThreshold =
      !manifest.masks[0].expectedAboveThreshold;
    await writeFile(file, JSON.stringify(manifest));
    await assert.rejects(verifySpatialCorpus(directory), /mask label/);
  });
});
test('generation reproduces upstream opaque recolouring without scaling or temporal padding', () => {
  assert.deepEqual(
    sourceFrame(
      new Uint8Array([0, 1]),
      [202, 202, 202, 255],
      [10, 20, 30, 255],
    ),
    Buffer.from([202, 202, 202, 255, 10, 20, 30, 255]),
  );
  assert.throws(
    () =>
      sourceFrame(new Uint8Array([1]), [202, 202, 202, 255], [10, 20, 30, 128]),
    /opaque/,
  );
});

test('independent PNG reconstruction proves the two labelled failing masks contain fewer pixels than the field threshold', async () => {
  for (const [name, expected] of [
    ['f011', 21282],
    ['f012', 21402],
  ]) {
    const png = await readFile(
      resolve(
        root,
        `upstream/area_patterns/25pct_341x256/${name}_on_341x256_fhd.png`,
      ),
    );
    const decoded = decodePngAlpha(png);
    assert.equal(decoded.width, 1920);
    assert.equal(decoded.height, 1080);
    const total = decoded.mask.reduce((sum, pixel) => sum + pixel, 0);
    assert.equal(total, expected);
    assert.ok(total < (341 * 256) / 4);
    const invalid = Buffer.from(png);
    invalid[28] = 1;
    assert.throws(() => decodePngAlpha(invalid), /noninterlaced/);
  }
});
test('decoded framing verifies every hash, count and trailing byte across arbitrary pipe chunks', async () => {
  const first = Buffer.from([1, 2, 3, 255]),
    second = Buffer.from([4, 5, 6, 255]),
    expected = [hash(first), hash(second)];
  const chunks = async function* () {
    yield first.subarray(0, 1);
    yield Buffer.concat([first.subarray(1), second.subarray(0, 2)]);
    yield second.subarray(2);
  };
  const frames = [];
  assert.deepEqual(
    await verifyDecodedFrames(chunks(), 4, expected, (value) =>
      frames.push(Buffer.from(value)),
    ),
    expected,
  );
  assert.deepEqual(frames, [first, second]);
  await assert.rejects(
    verifyDecodedFrames([first], 4, expected, () => undefined),
    /Truncated/,
  );
  await assert.rejects(
    verifyDecodedFrames(
      [first, second.subarray(0, 2)],
      4,
      expected,
      () => undefined,
    ),
    /Truncated/,
  );
  await assert.rejects(
    verifyDecodedFrames([second, first], 4, expected, () => undefined),
    /hash mismatch/,
  );
  await assert.rejects(
    verifyDecodedFrames([first, second, first], 4, expected, () => undefined),
    /hash mismatch/,
  );
});
test('frame timing rejects altered cadence, missing frames and a lossy codec', () => {
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
  assert.throws(() => verifyFrameTimes(probe, 3, 30), /frame count/);
  probe.frames[1].best_effort_timestamp_time = '0.066667';
  assert.throws(() => verifyFrameTimes(probe, 2, 30), /timestamp mismatch/);
  probe.streams[0].codec_name = 'h264';
  assert.throws(() => verifyFrameTimes(probe, 2, 30), /codec/);
});

test('reviewed baseline disagreements stay visible and cannot offset a new missed case', async () => {
  const baseline = JSON.parse(
    await readFile(resolve(root, 'first-encounter-0.4.0.json'), 'utf8'),
  );
  assert.equal(
    compareSpatialBaseline(baseline, baseline).status,
    'NO_NEW_MISMATCHES',
  );
  const report = structuredClone(baseline);
  const missed = report.masks.find(
    (value) => value.expectedCandidate && !value.observedCandidate,
  );
  missed.observedCandidate = true;
  const formerlyCorrect = report.masks.find(
    (value) =>
      value.expectedCandidate &&
      value.observedCandidate &&
      value.id !== missed.id,
  );
  formerlyCorrect.observedCandidate = false;
  const compared = compareSpatialBaseline(report, baseline);
  assert.equal(compared.status, 'REGRESSION');
  assert.equal(compared.improvements.length, 1);
  assert.equal(compared.newMismatches.length, 1);
  report.videos[0].csvExpectedCandidate =
    !report.videos[0].csvExpectedCandidate;
  assert.throws(
    () => compareSpatialBaseline(report, baseline),
    /label or sampling/,
  );
});
