// Frozen externally authored compositions; numeric decoding only, never playback.
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

import { readFile } from 'node:fs/promises';

import { basename, dirname, relative, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { safeReferencePath } from './validate-spatial-media.mjs';

import { requiredFile } from './reference-files.mjs';
import { repositoryRoot } from './validate-alternating-heldout.mjs';

export const corpus = fileURLToPath(
  new URL('../tests/reference/trace-alternating-heldout/', import.meta.url),
);

export const FROZEN_MANIFEST_SHA256 =
  '435e47961469043376dde6e90c52e726604a66366087a6537f351cdf64740092';

export const frozenEngine =
  'c216fbe2c9de76354061c35ba4df09e7e0a25731e5be247f3a7092aca2ca687a';

export const repository = 'https://github.com/traceRERC/pse-test-media';

export const commit = 'ef78542aad496827f25064f57aaf13d6a741ba75';

const family = 'video_creation/30fps_alternating_01';

const ids = [
  'f001c037',
  'f001f037',
  'f002c033',
  'f002c037',
  'f003c038',
  'f003f033',
  'f004c032',
  'f004c034',
  'f005c031',
  'f005f034',
  'f006c035',
  'f006f031',
  'f007c032',
  'f007c038',
  'f008c035',
  'f008c036',
];

export const hash = (
  /** @type {import("node:crypto").BinaryLike} */ bytes,
  algorithm = 'sha256',
) => createHash(algorithm).update(bytes).digest('hex');

/**
 * @param {import("./helper-types.js").SourceFile & {bytes:number}} file
 * @param {Buffer} bytes
 */
export function verifyAlternatingFile(file, bytes) {
  assert.equal(file.sourceUrl, `${repository}/blob/${commit}/${file.path}`);
  assert.equal(bytes.length, file.bytes, 'Source length mismatch');
  assert.equal(hash(bytes), file.sha256, 'Source SHA-256 mismatch');
  assert.equal(
    hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1'),
    file.gitBlobSha1,
    'Git blob mismatch',
  );
}

/** Labels and event annotations are checked against original bytes, never inferred from engine output. */
/**
 * @param {import("./helper-types.js").AlternatingManifest} manifest
 * @param {Map<string, Buffer>} files
 */
export function validateAlternatingContract(manifest, files) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.repository, repository);
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.frozenEngineTreeSha256, frozenEngine);
  assert.equal(manifest.files.length, 46);
  assert.equal(
    new Set(manifest.files.map((f) => f.path)).size,
    46,
    'Duplicate reference',
  );
  assert.deepEqual(
    manifest.videos.map((v) => v.path).sort(),
    ids.map((id) => `${family}/${id}.json`),
    'All 16 selected configurations must remain present',
  );
  const rows = requiredFile(files, `${family}/30fps_alternating_01.csv`)
    .toString()
    .trim()
    .split(/\r?\n/);
  assert.equal(rows.shift(), 'filename,pass,dimension');
  const labels = new Map(
    rows.map((row) => {
      const [id, pass, dimension] = row.split(',');
      return [id, { pass, dimension }];
    }),
  );
  assert.equal(labels.size, 16);
  assert.deepEqual([...labels.keys()].sort(), ids);
  const spatial = new Set(),
    temporal = new Set();
  for (const item of manifest.videos) {
    /** @type {import("./helper-types.js").VideoConfig} */
    const config = JSON.parse(requiredFile(files, item.path).toString());
    assert.equal(config.framerate, 30);
    assert.equal(config.colormodel, 'sRGBA');
    assert.equal(config.pattern.length, 1);
    assert.match(config.bgcolor, /^\(\d+,\d+,\d+,255\)$/);
    const label = labels.get(basename(item.path, '.json'));
    assert.ok(label, 'Missing source label');
    assert.ok(['TRUE', 'FALSE'].includes(label.pass));
    assert.ok(['count', 'FAIL'].includes(label.dimension));
    assert.equal(
      item.upstreamCsvPass,
      label.pass,
      'Original CSV label changed',
    );
    assert.equal(
      item.upstreamCsvDimension,
      label.dimension,
      'Original CSV dimension changed',
    );
    assert.equal(
      item.expectedWcagClassic,
      config.expected_result?.wcag2_2,
      'Original JSON label changed',
    );
    assert.deepEqual(
      item.eventAnnotations,
      config.events ?? null,
      'Original event annotations changed',
    );
    assert.deepEqual(
      item.failureDetails,
      config.failure_details ?? null,
      'Original failure annotations changed',
    );
    for (const key of /** @type {const} */ (['spatial', 'temporal_color'])) {
      const dep = relative(
        '/upstream',
        safeReferencePath(
          '/upstream',
          resolve('/upstream', dirname(item.path), config.pattern[0][key]),
        ),
      );
      assert.equal(item.dependencies[key], dep, 'Dependency identity changed');
      assert.ok(files.has(dep), 'Dependency missing');
    }
    spatial.add(item.dependencies.spatial);
    temporal.add(item.dependencies.temporal_color);
  }
  assert.equal(spatial.size, 8);
  assert.equal(temporal.size, 12);
  assert.deepEqual(manifest.counts, {
    configurations: 16,
    spatialSources: 8,
    temporalSources: 12,
    files: 46,
    csvExpectedPositives: 4,
    csvExpectedNegatives: 12,
    spatialSourcesWithPreviousBytes: 0,
    temporalSourcesWithPreviousBytes: 12,
  });
  return { spatial, temporal };
}

export async function verifyAlternatingCorpus(root = corpus) {
  const bytes = await readFile(resolve(root, 'manifest.json'));
  assert.equal(
    hash(bytes),
    FROZEN_MANIFEST_SHA256,
    'Pre-scoring manifest changed',
  );
  /** @type {import("./helper-types.js").AlternatingManifest} */
  const manifest = JSON.parse(bytes.toString()),
    files = /** @type {Map<string,Buffer>} */ (new Map());
  for (const file of manifest.files) {
    const bytes = await readFile(
      safeReferencePath(resolve(root, 'upstream'), file.path),
    );
    verifyAlternatingFile(file, bytes);
    files.set(file.path, bytes);
  }
  const sets = validateAlternatingContract(manifest, files);
  /** @type {(import("./helper-types.js").SourceFile & {manifest:string})[]} */
  const prior = [];
  for (const file of manifest.priorManifests) {
    const bytes = await readFile(safeReferencePath(repositoryRoot, file.path));
    assert.equal(hash(bytes), file.sha256, 'Prior overlap inventory changed');
    for (const item of JSON.parse(bytes.toString()).files)
      prior.push({ manifest: file.path, ...item });
  }
  for (const file of manifest.files) {
    const overlap = prior
      .filter((old) => old.sha256 === file.sha256)
      .map((old) => ({
        manifest: old.manifest,
        path: old.path,
        match:
          old.path === file.path
            ? 'SAME_PATH_AND_BYTES'
            : 'SAME_BYTES_DIFFERENT_PATH',
      }));
    assert.deepEqual(
      file.overlapWithPriorCorpora,
      overlap,
      'Overlap inventory changed',
    );
    if (
      (file.path.endsWith('.json') && file.path.startsWith(family + '/')) ||
      sets.spatial.has(file.path)
    )
      assert.equal(
        overlap.length,
        0,
        'New composition/mask was already evaluated',
      );
    if (sets.temporal.has(file.path))
      assert.ok(
        overlap.length,
        'Known temporal source incorrectly described as unseen',
      );
  }
  return { manifest, files, upstream: resolve(root, 'upstream') };
}
