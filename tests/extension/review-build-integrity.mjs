import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
/** Hash every copied extension file to detect test instrumentation.
 * @param {string} extension
 */
export async function extensionHashes(extension) {
  const hashes = {};
  for (const name of (await readdir(extension)).sort()) {
    hashes[name] = createHash('sha256')
      .update(await readFile(path.join(extension, name)))
      .digest('hex');
  }
  return hashes;
}

/** Assert retained source bytes were not rewritten by the UI test.
 * @param {{name: string, sha256: string}[]} sourceFiles
 */
export async function assertReviewSources(sourceFiles) {
  const sourceDirectory = new URL('./evidence/', import.meta.url);
  for (const source of sourceFiles) {
    const bytes = await readFile(new URL(source.name, sourceDirectory));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      source.sha256,
    );
  }
}
