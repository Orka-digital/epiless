import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import ts from 'typescript';

/** @typedef {{source:string,target:string,specifier:string,typeOnly:boolean}} Edge */
/** Read static imports, re-exports, import types and literal dynamic imports.
 * @param {string} file
 * @param {string} source
 * @returns {{specifier:string,typeOnly:boolean}[]}
 */
export function importReferences(file, source) {
  const text = file.endsWith('.astro')
    ? (source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '')
    : source;
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  /** @type {{specifier:string,typeOnly:boolean}[]} */
  const imports = [];
  /** @param {ts.Node} node */
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: Boolean(
          clause?.isTypeOnly ||
          (!clause?.name &&
            named &&
            ts.isNamedImports(named) &&
            named.elements.length &&
            named.elements.every((e) => e.isTypeOnly)),
        ),
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const named = node.exportClause;
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly:
          node.isTypeOnly ||
          Boolean(
            named &&
            ts.isNamedExports(named) &&
            named.elements.length &&
            named.elements.every((e) => e.isTypeOnly),
          ),
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      imports.push({ specifier: node.argument.literal.text, typeOnly: true });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}

/** Resolve local imports using the same source extensions as the workspace builds.
 * @param {string} from
 * @param {string} specifier
 * @returns {string | undefined}
 */
function resolveSource(from, specifier) {
  const path = resolve(dirname(from), specifier);
  const stem = path.replace(/\.js$/, '');
  return [
    stem + '.ts',
    stem + '.tsx',
    path,
    path + '.ts',
    path + '.tsx',
    path + '.astro',
    path + '/index.ts',
    path + '/index.tsx',
  ].find(
    (candidate) =>
      existsSync(candidate) &&
      ['.ts', '.tsx', '.astro', '.mjs', '.js'].includes(extname(candidate)),
  );
}

/** Return one strongly connected component per runtime cycle, including self-imports.
 * Type-only dependencies cannot execute and are excluded from runtime cycle detection.
 * @param {Edge[]} edges
 * @returns {string[][]}
 */
export function runtimeCycles(edges) {
  /** @type {Map<string,string[]>} */
  const graph = new Map();
  for (const edge of edges.filter((e) => !e.typeOnly))
    graph.set(edge.source, [...(graph.get(edge.source) ?? []), edge.target]);
  const index = new Map(),
    low = new Map(),
    active = new Set();
  /** @type {string[]} */ const stack = [];
  /** @type {string[][]} */ const cycles = [];
  let next = 0;
  /** @param {string} node */
  function visit(node) {
    index.set(node, next);
    low.set(node, next++);
    stack.push(node);
    active.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node), low.get(target)));
      } else if (active.has(target))
        low.set(node, Math.min(low.get(node), index.get(target)));
    }
    if (low.get(node) !== index.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      if (member === undefined) throw new Error('Invalid graph stack');
      active.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || graph.get(node)?.includes(node))
      cycles.push(component.sort());
  }
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return cycles;
}

/** Build source edges and reject undeclared public package entrypoints.
 * @param {string} root
 * @param {string[]} files Absolute maintained source paths.
 * @param {Map<string,{directory:string,exports:Record<string,string>}>} packages
 */
export function dependencyGraph(root, files, packages) {
  /** @type {Edge[]} */ const edges = [];
  /** @type {string[]} */ const errors = [];
  for (const file of files)
    for (const ref of importReferences(file, readFileSync(file, 'utf8'))) {
      let target;
      if (ref.specifier.startsWith('.'))
        target = resolveSource(file, ref.specifier);
      else if (ref.specifier.startsWith('@epi-less/')) {
        const [scope, name, ...rest] = ref.specifier.split('/');
        const pkg = packages.get(`${scope}/${name}`);
        const entry = pkg?.exports[rest.length ? './' + rest.join('/') : '.'];
        if (!entry) {
          errors.push(
            `${relative(root, file)}: undeclared package entry ${ref.specifier}`,
          );
          continue;
        }
        target = resolveSource(resolve(pkg.directory, 'package.json'), entry);
      }
      if (target)
        edges.push({
          source: relative(root, file),
          target: relative(root, target),
          ...ref,
        });
    }
  return { edges, errors };
}
