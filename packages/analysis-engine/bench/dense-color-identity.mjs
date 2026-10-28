import { createHash } from 'node:crypto';

import { readFile, readdir } from 'node:fs/promises';

import { join } from 'node:path';

import { pathToFileURL } from 'node:url';

import { tsImport } from 'tsx/esm/api';

export const files = [
  'color-cache.ts',
  'diagnostic-history.ts',
  'index.ts',
  'spatial.ts',
];

export const hash = (/** @type {import("node:crypto").BinaryLike} */ value) =>
  createHash('sha256').update(value).digest('hex');

/**
 * @param {string} source
 */
export async function identity(source) {
  const tree = createHash('sha256');
  /** @type {Record<string,{bytes:number,sha256:string}>} */
  const entries = {};
  for (const name of (await readdir(source))
    .filter((name) => name.endsWith('.ts'))
    .sort()) {
    const bytes = await readFile(join(source, name));
    tree.update(name).update(bytes);
    entries[name] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  return { treeSha256: tree.digest('hex'), files: entries };
}

/**
 * @param {string} source
 * @returns {Promise<import("./probe-types.js").EngineModule>}
 */
export async function importAnalyzer(source) {
  return tsImport(
    pathToFileURL(join(source, 'index.ts')).href,
    import.meta.url,
  );
}
