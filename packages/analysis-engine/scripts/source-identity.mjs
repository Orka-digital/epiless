import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Hash every source file, including split modules and the packaged kernel.
 * @param {URL | string} [directory]
 */
export async function engineSourceIdentity(
  directory = new URL('../src/', import.meta.url),
) {
  const root = directory instanceof URL ? fileURLToPath(directory) : directory;
  /**
   * @type {string[]}
   */
  const files = [];
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  await visit();
  const hash = createHash('sha256');
  for (const name of files.sort())
    hash
      .update(name)
      .update('\0')
      .update(await readFile(path.join(root, name)))
      .update('\0');
  return {
    basis: 'SORTED_SOURCE_PATH_NUL_BYTES_NUL_V1',
    sha256: hash.digest('hex'),
    files,
  };
}
