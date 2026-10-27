import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verifyDenseKernel } from '../packages/analysis-engine/scripts/verify-wasm.mjs';

/** Additional kernel provenance; historical engine hash fields retain their
 * original algorithms. This check does not claim a compiler rebuild. */
export async function detectionKernelIdentity() {
  const checked = await verifyDenseKernel();
  const hash = async (/** @type {string} */ relative) =>
    createHash('sha256')
      .update(await readFile(new URL(relative, import.meta.url)))
      .digest('hex');
  return {
    ...checked,
    manifestSha256: await hash(
      '../packages/analysis-engine/src/wasm/kernel-manifest.json',
    ),
    verifierSha256: await hash(
      '../packages/analysis-engine/scripts/verify-wasm.mjs',
    ),
  };
}

/**
 * @param {Pick<import("../packages/analysis-engine/src/index.ts").FrameAnalyzer,"getBackendStats">} analyzer
 */
export function backendExecution(analyzer) {
  const { backend, selectionReason, denseFrames, inputCopiedBytes } =
    analyzer.getBackendStats();
  return { backend, selectionReason, denseFrames, inputCopiedBytes };
}
