// Manual native tabCapture + extension-owned debugger integration gate.
// No Playwright connection attaches to this browser. Start through its toolbar.

import { createHash } from 'node:crypto';

import { readFile, readdir } from 'node:fs/promises';

import path from 'node:path';

export async function hashDirectory(directory) {
  const hash = createHash('sha256');
  for (const name of (await readdir(directory)).sort()) {
    hash.update(name);
    hash.update('\0');
    hash.update(await readFile(path.join(directory, name)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Require exactly one source identity in a cold production bundle.
 * @param {string} production
 */
export async function readEmbeddedBuildIdentity(production) {
  const bundle = await readFile(path.join(production, 'background.js'), 'utf8');
  const identities = [
    ...new Set(
      [...bundle.matchAll(/["']([a-f0-9]{64})["']/g)].map((match) => match[1]),
    ),
  ];
  if (identities.length !== 1)
    throw new Error(
      'Owned fixture requires one unambiguous cold-build source identity in the actual background bundle.',
    );
  return identities[0];
}
