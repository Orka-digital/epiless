import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { scannerSourceFingerprint } from '../../apps/chrome-extension/source-fingerprint.mjs';

it('binds scanner comparisons to source and locked tools, independent of checkout path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flashguard-fingerprint-'));
  const first = path.join(root, 'first'),
    second = path.join(root, 'second');
  try {
    for (const filename of [
      'apps/chrome-extension/src/background.ts',
      'apps/chrome-extension/build.mjs',
      'apps/chrome-extension/source-fingerprint.mjs',
      'apps/chrome-extension/package.json',
      'packages/analysis-engine/src/index.ts',
      'packages/analysis-engine/src/wasm/dense.c',
      'packages/analysis-engine/src/dense-kernel.generated.ts',
      'packages/analysis-engine/scripts/verify-wasm.mjs',
      'packages/analysis-engine/package.json',
      'packages/core/src/report.ts',
      'packages/core/package.json',
      'pnpm-lock.yaml',
    ]) {
      await mkdir(path.dirname(path.join(first, filename)), {
        recursive: true,
      });
      await writeFile(path.join(first, filename), filename);
    }
    const original = await scannerSourceFingerprint(first);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    await cp(first, second, { recursive: true });
    expect(await scannerSourceFingerprint(second)).toBe(original);
    await writeFile(
      path.join(second, 'packages/analysis-engine/src/index.ts'),
      'changed detector',
    );
    expect(await scannerSourceFingerprint(second)).not.toBe(original);
    await cp(first, second, { recursive: true });
    await writeFile(
      path.join(second, 'packages/analysis-engine/src/wasm/dense.c'),
      'changed kernel source',
    );
    expect(await scannerSourceFingerprint(second)).not.toBe(original);
    await cp(first, second, { recursive: true });
    await writeFile(
      path.join(
        second,
        'packages/analysis-engine/src/dense-kernel.generated.ts',
      ),
      'changed packaged kernel bytes',
    );
    expect(await scannerSourceFingerprint(second)).not.toBe(original);
    await writeFile(path.join(first, 'pnpm-lock.yaml'), 'changed toolchain');
    expect(await scannerSourceFingerprint(first)).not.toBe(original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
