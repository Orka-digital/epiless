import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
/** Hash the validator and its extracted decoding/comparison helpers for reproducible evidence. */
export async function alternatingHarnessIdentity() {
  return Promise.all(
    [
      'validate-alternating-heldout.mjs',
      'validate-alternating-regression.mjs',
      'reference-ffv1.mjs',
      'validate-spatial-media.mjs',
      'validate-detection.mjs',
      'validate-expanded.mjs',
      'detection-kernel.mjs',
      'alternating-corpus.mjs',
      'alternating-media.mjs',
      'alternating-video.mjs',
      'alternating-baseline.mjs',
      'spatial-corpus.mjs',
      'spatial-decoding.mjs',
      'spatial-video.mjs',
      'spatial-baseline.mjs',
      'temporal-colors.mjs',
      'temporal-general.mjs',
      'temporal-red.mjs',
      'detection-summary.mjs',
      'alternating-harness-identity.mjs',
    ].map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(new URL(path, import.meta.url)))
        .digest('hex'),
    })),
  );
}
