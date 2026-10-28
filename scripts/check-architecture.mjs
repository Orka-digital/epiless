import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dependencyGraph, runtimeCycles } from './architecture-graph.mjs';
import { boundaryViolation } from './architecture-policy.mjs';
const root = process.cwd();
/** @type {string[]} */ const files = [];
/** @param {string} directory */
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (
      /\.(ts|tsx|astro|mjs|js)$/.test(path) &&
      !path.endsWith('.generated.ts')
    )
      files.push(path);
  }
}
/** @type {Map<string,{directory:string,exports:Record<string,string>}>} */ const packages =
  new Map();
for (const group of ['apps', 'packages'])
  for (const entry of readdirSync(group, { withFileTypes: true }))
    if (entry.isDirectory()) {
      const directory = resolve(group, entry.name);
      const pkg = JSON.parse(
        readFileSync(resolve(directory, 'package.json'), 'utf8'),
      );
      packages.set(pkg.name, {
        directory,
        exports:
          typeof pkg.exports === 'string'
            ? { '.': pkg.exports }
            : (pkg.exports ?? {}),
      });
      walk(resolve(directory, 'src'));
    }
const { edges, errors } = dependencyGraph(root, files, packages);
for (const edge of edges) {
  const reason = boundaryViolation(edge);
  if (reason) errors.push(`${edge.source} -> ${edge.target}: ${reason}`);
}
for (const cycle of runtimeCycles(edges))
  errors.push(`Runtime import cycle: ${cycle.join(' -> ')}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Architecture: ${files.length} source files, no runtime cycles or forbidden dependencies.`,
  );
