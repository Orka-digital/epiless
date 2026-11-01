import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
/** Fingerprint the executable bundles and fixture helpers used for phase evidence. */
export async function phaseExecutionIdentity(nodeBundle, contentBundle) {
  return {
    nodeBundleSha256: createHash('sha256').update(nodeBundle).digest('hex'),
    contentBundleSha256: createHash('sha256')
      .update(contentBundle)
      .digest('hex'),
    fixtureHelpers: await Promise.all(
      [
        'animation-phase-jobs.mjs',
        'animation-phase-observer.mjs',
        'animation-phase-identity.mjs',
      ].map(async (path) => ({
        path,
        sha256: createHash('sha256')
          .update(await readFile(new URL(path, import.meta.url)))
          .digest('hex'),
      })),
    ),
    fixtureScriptSha256: createHash('sha256')
      .update(
        await readFile(new URL('animation-phase-browser.mjs', import.meta.url)),
      )
      .digest('hex'),
  };
}
