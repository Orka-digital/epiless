import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Source/toolchain identity, independent of absolute checkout path and mtime.
 * This is provenance for comparisons, not a signature or self-verifying binary.
 * @param {string} repositoryRoot
 */
export async function scannerSourceFingerprint(repositoryRoot) {
  const files = [];
  /**
   * @param {string} relative
   */
  async function collect(relative) {
    for (const entry of await readdir(path.join(repositoryRoot, relative), {
      withFileTypes: true,
    })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  for (const directory of [
    'apps/chrome-extension/src',
    'packages/analysis-engine/src',
    'packages/core/src',
  ])
    await collect(directory);
  files.push(
    'apps/chrome-extension/build.mjs',
    'apps/chrome-extension/source-fingerprint.mjs',
    'apps/chrome-extension/package.json',
    'packages/analysis-engine/package.json',
    'packages/analysis-engine/scripts/verify-wasm.mjs',
    'packages/core/package.json',
    'pnpm-lock.yaml',
  );
  const hash = createHash('sha256');
  for (const name of files.sort())
    hash
      .update(name)
      .update('\0')
      .update(await readFile(path.join(repositoryRoot, name)))
      .update('\0');
  return hash.digest('hex');
}
