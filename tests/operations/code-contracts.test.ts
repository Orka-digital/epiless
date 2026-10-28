import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { codeQualityFindings } from '../../scripts/code-quality-findings.mjs';
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'epi-contracts-'));
  directories.push(root);
  mkdirSync(join(root, 'apps/example/src'), { recursive: true });
  writeFileSync(join(root, 'apps/example/src/module.ts'), source);
  return root;
}
it('requires documentation at exported function and class boundaries', async () => {
  const findings = await codeQualityFindings(
    fixture('export function missing() {}\nexport class Missing {}'),
  );
  expect(findings.map((f) => f.rule)).toEqual([
    'jsdoc/require-jsdoc',
    'jsdoc/require-jsdoc',
  ]);
  expect(
    await codeQualityFindings(
      fixture('/** Public contract. */\nexport function present() {}'),
    ),
  ).toEqual([]);
});
it('flags complex functions and changes their debt signature when behavior changes', async () => {
  const body = Array.from(
    { length: 21 },
    (_, i) => `if(value===${i})return ${i};`,
  ).join('\n');
  const source = `/** Compute a test value. */\nexport function choose(value:number){${body}return -1;}`;
  const first = await codeQualityFindings(fixture(source));
  expect(first[0]).toMatchObject({ rule: 'complexity', value: 22 });
  const changed = await codeQualityFindings(
    fixture(source.replace('return -1', 'return -2')),
  );
  expect(changed[0].signature).not.toBe(first[0].signature);
});
it('rejects nesting beyond four levels independently of function size', async () => {
  const source =
    '/** Nested contract fixture. */\nexport function nested(value:boolean){if(value){if(value){if(value){if(value){if(value){return;}}}}}}';
  expect(await codeQualityFindings(fixture(source))).toEqual([
    expect.objectContaining({ rule: 'max-depth', value: 5 }),
  ]);
});
