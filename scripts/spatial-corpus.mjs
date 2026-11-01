import { createHash } from 'node:crypto';

import { readFile } from 'node:fs/promises';

import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { requiredFile } from './reference-files.mjs';

export const defaultRoot = fileURLToPath(
  new URL('../tests/reference/trace-spatial/', import.meta.url),
);

export const repository = 'https://github.com/traceRERC/pse-test-media';

export const commit = 'ef78542aad496827f25064f57aaf13d6a741ba75';

export const hash = (
  /** @type {import("node:crypto").BinaryLike} */ bytes,
  algorithm = 'sha256',
) => createHash(algorithm).update(bytes).digest('hex');

/**
 * @param {string} root
 * @param {string} path
 */
export function safeReferencePath(root, path) {
  if (typeof path !== 'string' || !path)
    throw new Error('Invalid reference path');
  const file = resolve(root, path),
    rel = relative(root, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Reference path escapes corpus');
  return file;
}

/** Labels come from pinned upstream JSON and CSV separately, including source disagreements. */
export async function verifySpatialCorpus(root = defaultRoot) {
  const manifestBytes = await readFile(resolve(root, 'manifest.json'));
  /** @type {import("./helper-types.js").SpatialManifest} */
  const manifest = JSON.parse(manifestBytes.toString());
  if (
    manifest.schemaVersion !== 1 ||
    manifest.repository !== repository ||
    manifest.commit !== commit ||
    !Array.isArray(manifest.files) ||
    manifest.masks?.length !== 24 ||
    manifest.videos?.length !== 36
  )
    throw new Error('Invalid spatial manifest');
  const upstream = resolve(root, 'upstream'),
    files = /** @type {Map<string,Buffer>} */ (new Map());
  for (const item of manifest.files) {
    const path = safeReferencePath(upstream, item.path);
    if (
      files.has(item.path) ||
      item.sourceUrl !== `${repository}/blob/${commit}/${item.path}`
    )
      throw new Error('Duplicate reference or invalid provenance');
    const bytes = await readFile(path);
    if (
      hash(bytes) !== item.sha256 ||
      hash(
        Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]),
        'sha1',
      ) !== item.gitBlobSha1
    )
      throw new Error(`Reference hash mismatch: ${item.path}`);
    files.set(item.path, bytes);
  }
  const masks = new Set(),
    videos = new Set();
  for (const item of manifest.masks) {
    if (
      !/^area_patterns\/25pct_341x256\/[af]\d{3}_on_341x256_fhd\.png$/.test(
        item.path,
      ) ||
      item.expectedAboveThreshold !== basename(item.path).startsWith('f') ||
      masks.has(item.path) ||
      !files.has(item.path)
    )
      throw new Error('Spatial mask label, identity or file changed');
    masks.add(item.path);
  }
  for (const item of manifest.videos) {
    if (
      !/^video_creation\/wcagc_30fps_area0[123]\/[af]\d{3}fr?\d{3}\.json$/.test(
        item.path,
      ) ||
      videos.has(item.path) ||
      !files.has(item.path)
    )
      throw new Error('Invalid or duplicate video reference');
    videos.add(item.path);
    /** @type {import("./helper-types.js").VideoConfig} */
    const config = JSON.parse(requiredFile(files, item.path).toString());
    if (item.expectedWcagClassic !== config.expected_result?.wcag2_2)
      throw new Error('Manifest label differs from original configuration');
    if (
      config.framerate !== 30 ||
      config.colormodel !== 'sRGBA' ||
      config.pattern?.length !== 1 ||
      !/^\(\d+,\d+,\d+,255\)$/.test(config.bgcolor)
    )
      throw new Error('Unsupported upstream generation configuration');
    const parent = dirname(item.path),
      pattern = config.pattern[0];
    for (const dependency of [pattern.spatial, pattern.temporal_color]) {
      const resolved = safeReferencePath(
        upstream,
        resolve(upstream, parent, dependency),
      );
      if (!files.has(relative(upstream, resolved)))
        throw new Error(`Unpinned dependency: ${dependency}`);
    }
    const labelsPath = `${parent}/${basename(parent)}.csv`;
    if (!files.has(labelsPath))
      throw new Error('Missing independent CSV label source');
    const rows = requiredFile(files, labelsPath)
      .toString('utf8')
      .trim()
      .split(/\r?\n/);
    if (rows.shift() !== 'filename,pass,dimension')
      throw new Error('Unexpected spatial label header');
    const labels = rows.map((row) => row.split(','));
    const matches = labels.filter(
      (row) => row[0] === basename(item.path, '.json'),
    );
    if (
      matches.length !== 1 ||
      !['TRUE', 'FALSE'].includes(matches[0][1]) ||
      !['area', 'FAIL'].includes(matches[0][2])
    )
      throw new Error('Invalid original CSV video label');
    item.csvExpected = matches[0][1] === 'FALSE';
    item.csvLabelPath = labelsPath;
  }
  return { manifest, files, upstream, manifestSha256: hash(manifestBytes) };
}
