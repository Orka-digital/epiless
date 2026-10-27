import { expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { engineSourceIdentity } from '../../packages/analysis-engine/scripts/source-identity.mjs';

test('engine identity covers split modules and is independent of checkout path and creation order', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'epi-less-source-'));
  try {
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    for (const directory of [first, second])
      await mkdir(path.join(directory, 'nested'), { recursive: true });
    await writeFile(path.join(first, 'index.ts'), 'export {};');
    await writeFile(
      path.join(first, 'nested/detector.ts'),
      'const threshold = 7;',
    );
    await writeFile(
      path.join(second, 'nested/detector.ts'),
      'const threshold = 7;',
    );
    await writeFile(path.join(second, 'index.ts'), 'export {};');
    const before = await engineSourceIdentity(first);
    expect(await engineSourceIdentity(second)).toEqual(before);
    expect(before.files).toEqual(['index.ts', 'nested/detector.ts']);
    await writeFile(
      path.join(second, 'nested/detector.ts'),
      'const threshold = 8;',
    );
    expect((await engineSourceIdentity(second)).sha256).not.toBe(before.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
