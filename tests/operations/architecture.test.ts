import { describe, expect, it } from 'vitest';
import {
  importReferences,
  runtimeCycles,
} from '../../scripts/architecture-graph.mjs';
import { boundaryViolation } from '../../scripts/architecture-policy.mjs';

describe('architecture boundaries', () => {
  it('finds executable imports, reexports and dynamic imports without treating type imports as runtime edges', () => {
    const imports = importReferences(
      'sample.ts',
      `import type { A } from './a';import {type B} from './b';export * from './c';export type {D} from './d';const load=()=>import('./e');type F=import('./f').F;`,
    );
    expect(imports).toEqual([
      { specifier: './a', typeOnly: true },
      { specifier: './b', typeOnly: true },
      { specifier: './c', typeOnly: false },
      { specifier: './d', typeOnly: true },
      { specifier: './e', typeOnly: false },
      { specifier: './f', typeOnly: true },
    ]);
  });
  it('checks Astro frontmatter imports', () => {
    expect(
      importReferences(
        'page.astro',
        `---\nimport View from './View';\n---\n<View/>`,
      ),
    ).toEqual([{ specifier: './View', typeOnly: false }]);
  });
  it('detects indirect and self cycles while allowing contract-only return edges', () => {
    const edge = (source: string, target: string, typeOnly = false) => ({
      source,
      target,
      typeOnly,
      specifier: './module',
    });
    expect(
      runtimeCycles([
        edge('a', 'b'),
        edge('b', 'c'),
        edge('c', 'a'),
        edge('d', 'd'),
      ]),
    ).toEqual([['a', 'b', 'c'], ['d']]);
    expect(runtimeCycles([edge('a', 'b'), edge('b', 'a', true)])).toEqual([]);
  });
  it('rejects cross-package internals even for type-only imports', () => {
    expect(
      boundaryViolation({
        source: 'packages/analysis-engine/src/a.ts',
        target: 'packages/core/src/spatial.ts',
        specifier: '../../core/src/spatial',
        typeOnly: true,
      }),
    ).toContain('package exports');
  });
  it.each([
    ['apps/web/src/components/Form.tsx', 'apps/web/src/server/auth.ts'],
    ['apps/web/src/server/db/query.ts', 'apps/web/src/server/account.ts'],
    [
      'apps/chrome-extension/src/View.tsx',
      'apps/chrome-extension/src/runner-commands.ts',
    ],
    [
      'apps/chrome-extension/src/runner-commands.ts',
      'apps/chrome-extension/src/View.tsx',
    ],
  ])('rejects forbidden runtime dependency %s -> %s', (source, target) => {
    expect(
      boundaryViolation({
        source,
        target,
        specifier: './module',
        typeOnly: false,
      }),
    ).toBeTruthy();
  });
  it('permits UI contracts and ordinary database schema dependencies', () => {
    expect(
      boundaryViolation({
        source: 'apps/web/src/components/Form.tsx',
        target: 'apps/web/src/server/types.ts',
        specifier: '../server/types',
        typeOnly: true,
      }),
    ).toBeUndefined();
    expect(
      boundaryViolation({
        source: 'apps/web/src/server/db/query.ts',
        target: 'apps/web/src/server/db/schema.ts',
        specifier: './schema',
        typeOnly: false,
      }),
    ).toBeUndefined();
  });
});
