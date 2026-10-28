import { createHash } from 'node:crypto';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import ts from 'typescript';
import { relative } from 'node:path';

/** @typedef {{file:string,rule:string,signature:string,value:number,label:string}} Finding */
/** Find the enclosing function/class, so moving it cannot hide existing complexity debt.
 * The signature excludes formatting; any substantive change must satisfy the default limit.
 * @param {string} file
 * @param {string} source
 * @param {number} line
 * @param {number} column
 */
function contractAt(file, source, line, column) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const position = ast.getPositionOfLineAndCharacter(line - 1, column - 1);
  /** @type {ts.Node} */ let selected = ast;
  /** @param {ts.Node} node */
  function visit(node) {
    if (node.getStart(ast) > position || node.end <= position) return;
    if (ts.isFunctionLike(node) || ts.isClassDeclaration(node)) selected = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const text = selected.getText(ast);
  return createHash('sha256')
    .update(text.replace(/\s+/g, ' '))
    .digest('hex')
    .slice(0, 20);
}

/** Run syntax-only ESLint contract checks; normal lint owns semantic/type-aware rules.
 * @param {string} root
 * @returns {Promise<Finding[]>}
 */
export async function codeQualityFindings(root) {
  const lint = new ESLint({
    cwd: root,
    errorOnUnmatchedPattern: false,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx}'],
        // Semantic lint owns directives for rules outside this focused contract pass.
        linterOptions: { reportUnusedDisableDirectives: 'off' },
        ignores: ['**/*.generated.ts'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
        plugins: { jsdoc },
        settings: { jsdoc: { mode: 'typescript' } },
        rules: {
          complexity: ['error', { max: 20, variant: 'modified' }],
          'max-depth': ['error', 4],
          'jsdoc/require-jsdoc': [
            'error',
            {
              publicOnly: true,
              require: {
                FunctionDeclaration: true,
                ClassDeclaration: true,
                MethodDefinition: false,
                ArrowFunctionExpression: false,
                FunctionExpression: false,
              },
            },
          ],
        },
      },
    ],
  });
  const results = await lint.lintFiles([
    'apps/*/src/**/*.{ts,tsx}',
    'packages/*/src/**/*.ts',
  ]);
  /** @type {Map<string,Finding>} */ const findings = new Map();
  for (const result of results)
    for (const message of result.messages) {
      const rule = message.ruleId ?? 'parse';
      const file = relative(root, result.filePath);
      const signature = contractAt(
        file,
        result.source ?? '',
        message.line,
        message.column,
      );
      const value = Number(
        message.message.match(/(?:complexity of |deeply \()(\d+)/)?.[1] ?? 1,
      );
      const key = `${file}:${rule}:${signature}`;
      const existing = findings.get(key);
      if (!existing || existing.value < value)
        findings.set(key, {
          file,
          rule,
          signature,
          value,
          label: message.message,
        });
    }
  return [...findings.values()].sort((a, b) =>
    `${a.file}:${a.signature}:${a.rule}`.localeCompare(
      `${b.file}:${b.signature}:${b.rule}`,
    ),
  );
}
