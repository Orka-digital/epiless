// Independent upstream labels; numeric analysis only, never rendered media.
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

import { readFile } from 'node:fs/promises';

import { resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

export const corpus = fileURLToPath(
  new URL('../tests/reference/trace-combo-heldout/', import.meta.url),
);

export const FROZEN_MANIFEST_SHA256 =
  'abaca272c1b8b0f0d58867bc14c077f7665d21cc67f72da82514370dee39cc36';

export const frozenEngine =
  'c216fbe2c9de76354061c35ba4df09e7e0a25731e5be247f3a7092aca2ca687a';

export const commit = 'ef78542aad496827f25064f57aaf13d6a741ba75';

export const repository = 'https://github.com/traceRERC/pse-test-media';

export const hash = (
  /** @type {import("node:crypto").BinaryLike} */ bytes,
  algorithm = 'sha256',
) => createHash(algorithm).update(bytes).digest('hex');

export const types = ['GENERAL_FLASH', 'RED_FLASH'];

/** This oracle comes solely from the pinned upstream README suffix convention. */
/**
 * @param {string} path
 */
export function expectedComboChannels(path) {
  const match = /^combo_flash_patterns\/30fps\/00[12](fb|fl|fr|p)\.csv$/.exec(
    path,
  );
  assert.ok(match, 'Unknown combo source: its label must remain unscored.');
  /** @type {Record<string, boolean[]>} */
  const labels = {
    fb: [true, true],
    fl: [true, false],
    fr: [false, true],
    p: [false, false],
  };
  return Object.fromEntries(
    types.map((type, index) => [type, labels[match[1]][index]]),
  );
}

/**
 * @param {import("./helper-types.js").ComboManifest} manifest
 */
export function validateComboContract(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.upstreamRepository, repository);
  assert.equal(manifest.upstreamCommit, commit);
  assert.equal(manifest.license, 'BSD-3-Clause');
  assert.equal(manifest.independentInputs, 8);
  assert.equal(manifest.channelChecks, 16);
  assert.equal(manifest.frozenEngine.typescriptTreeSha256, frozenEngine);
  assert.equal(manifest.files.length, 10);
  const paths = manifest.files.map((file) => file.path);
  assert.equal(new Set(paths).size, paths.length, 'Duplicate reference file');
  const required = ['LICENSE', 'combo_flash_patterns/30fps/README.md'];
  for (const series of ['001', '002'])
    for (const suffix of ['fb', 'fl', 'fr', 'p'])
      required.push(`combo_flash_patterns/30fps/${series}${suffix}.csv`);
  assert.deepEqual(
    [...paths].sort(),
    required.sort(),
    'All original inputs must remain selected.',
  );
  for (const file of manifest.files) {
    assert.equal(file.sourceUrl, `${repository}/blob/${commit}/${file.path}`);
    if (file.kind !== 'PROVENANCE') {
      assert.equal(file.kind, 'COMBINED_GENERAL_RED');
      assert.equal(file.framesPerSecond, 30);
      assert.deepEqual(
        file.expectedChannels,
        expectedComboChannels(file.path),
        'Upstream suffix labels must not be changed.',
      );
    } else assert.equal(file.kind, 'PROVENANCE');
  }
}

/**
 * @param {import("./helper-types.js").SourceFile & {size:number}} file
 * @param {Buffer} bytes
 */
export function verifyComboFile(file, bytes) {
  assert.equal(bytes.length, file.size, `Source length mismatch: ${file.path}`);
  assert.equal(
    hash(bytes),
    file.sha256,
    `Source SHA-256 mismatch: ${file.path}`,
  );
  assert.equal(
    hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1'),
    file.gitBlobSha1,
    `Git blob mismatch: ${file.path}`,
  );
}

export async function verifyComboCorpus(root = corpus) {
  const bytes = await readFile(resolve(root, 'manifest.json'));
  assert.equal(
    hash(bytes),
    FROZEN_MANIFEST_SHA256,
    'The pre-scoring manifest changed.',
  );
  /** @type {import("./helper-types.js").ComboManifest} */
  const manifest = JSON.parse(bytes.toString());
  validateComboContract(manifest);
  /** @type {Map<string, Buffer>} */
  const contents = new Map();
  for (const file of manifest.files) {
    const data = await readFile(resolve(root, 'upstream', file.path));
    verifyComboFile(file, data);
    contents.set(file.path, data);
  }
  /** @type {{files: import("./helper-types.js").SourceFile[]}[]} */
  const previous = await Promise.all(
    ['trace-pse', 'trace-pse-expanded', 'trace-spatial'].map(async (name) =>
      JSON.parse(
        (
          await readFile(
            new URL(
              `../tests/reference/${name}/manifest.json`,
              import.meta.url,
            ),
          )
        ).toString(),
      ),
    ),
  );
  for (const file of manifest.files.filter((file) =>
    file.path.endsWith('.csv'),
  )) {
    assert.ok(
      !previous.some((source) =>
        source.files.some(
          (prior) =>
            prior.path === file.path || prior.gitBlobSha1 === file.gitBlobSha1,
        ),
      ),
      'An already evaluated input must not be called held out.',
    );
  }
  return { manifest, contents };
}
