import { engineSourceIdentity } from '../scripts/source-identity.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

// Compile the local TypeScript module graph without emitting files or executing
// any browser/media content. Their only input is deterministic numeric arrays.
/** @type {Map<string,string>} */
const modules = new Map();
/**
 * @param {string} relative
 * @returns {Promise<string>}
 */
async function moduleUrl(relative) {
  const existing = modules.get(relative);
  if (existing) return existing;
  const file = new URL(relative, import.meta.url);
  const source = await readFile(file, 'utf8');
  let compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const dependencies = [...compiled.matchAll(/from ['"](\.[^'"]+)['"]/g)];
  for (const match of dependencies) {
    const path = new URL(match[1].replace(/\.js$/, '.ts'), file);
    const dependency = await moduleUrl(path.href);
    compiled = compiled.replace(match[0], `from '${dependency}'`);
  }
  const result = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  modules.set(relative, result);
  return result;
}
const { evaluateNumericCorpus } = await import(
  await moduleUrl('../validation/run.ts')
);
const treeHash = createHash('sha256');
for (const name of (await readdir(new URL('../src/', import.meta.url)))
  .filter((n) => n.endsWith('.ts'))
  .sort())
  treeHash
    .update(name)
    .update(await readFile(new URL('../src/' + name, import.meta.url)));
const result = {
  engineSourceTree: await engineSourceIdentity(),
  engineSourceTreeSha256: treeHash.digest('hex'),
  ...evaluateNumericCorpus(),
  engineSourceSha256: createHash('sha256')
    .update(await readFile(new URL('../src/index.ts', import.meta.url)))
    .digest('hex'),
};
console.log(JSON.stringify(result, null, 2));
if (result.mismatches.length) process.exitCode = 1;
