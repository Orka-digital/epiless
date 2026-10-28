import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
/** Bind retained proof output to every implementation used by the comparison harness.
 * @param {string} harnessUrl
 */
export async function proofIdentity(harnessUrl) {
  /** @param {string} relative */
  const hash = async (relative) =>
    createHash('sha256')
      .update(await readFile(new URL(relative, harnessUrl)))
      .digest('hex');
  return {
    harnessSha256: await hash(harnessUrl),
    caseRunnerSha256: await hash('./wasm-dense-case.mjs'),
    witnessValidatorSha256: await hash('./spatial-witness.mjs'),
    stateComparatorSha256: await hash('./state-comparison.mjs'),
    qualityProbeSha256: await hash('./quality-probe.mjs'),
    identityHelperSha256: await hash('./proof-identity.mjs'),
  };
}
