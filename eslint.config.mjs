import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import astro from 'eslint-plugin-astro';
import jsdoc from 'eslint-plugin-jsdoc';
import hooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // Frozen evidence and generated output must never be rewritten by lint:fix.
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/dist-advanced/**',
    '**/.astro/**',
    '**/.wrangler/**',
    '**/.output/**',
    '**/.playwright-mcp/**',
    '**/artifacts/**',
    '**/coverage/**',
    '**/test-results/**',
    '**/playwright-report/**',
    'tests/reference/**/upstream/**',
    'tests/extension/evidence/**',
    '**/*.generated.ts',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,astro}'],
    extends: [js.configs.recommended],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'max-lines': [
        'error',
        { max: 250, skipBlankLines: true, skipComments: true },
      ],
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Browser fixtures include functions serialized into a real Chromium page.
    files: [
      'tests/extension/**/*.{js,mjs}',
      'apps/chrome-extension/src/**/*.{ts,tsx}',
      'apps/web/src/**/*.astro',
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'tests/extension/**/*.{js,mjs}',
      'apps/chrome-extension/src/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: { chrome: 'readonly' } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  },
  ...astro.configs.recommended,
  {
    files: ['**/*.astro'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Astro frontmatter includes TypeScript signatures; use its TS-aware rule.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  {
    files: [
      'tests/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'tests/**/*.fixture.ts',
      'packages/*/test/**/*.fixture.ts',
    ],
    // Boundary tests deliberately build malformed messages and partial browser mocks.
    // Production sources retain the ban on explicit any.
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: [
      'tests/extension/animation-phase*-browser.mjs',
      'tests/extension/animation-phase-observer.mjs',
    ],
    languageOptions: { globals: { phase: 'readonly', stopPhase: 'readonly' } },
  },
  {
    files: ['tests/extension/browser-storage-migration.mjs'],
    languageOptions: {
      globals: {
        FlashGuardStorage: 'readonly',
        FlashGuardAnalysis: 'readonly',
      },
    },
  },
  {
    files: ['**/*.tsx'],
    extends: [hooks.configs.flat.recommended],
    rules: { 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/check-tag-names': 'error',
      'jsdoc/valid-types': 'error',
    },
  },
  {
    files: ['apps/web/src/server/**/*.ts'],
    ignores: ['apps/web/src/server/db/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.property.name='DB'][callee.property.name=/^(prepare|batch|exec)$/]",
          message:
            'Keep database operations in server/db; use Drizzle by default and document atomic SQL exceptions.',
        },
      ],
    },
  },
  // Formatting has one owner: Prettier. Keep this configuration last.
  prettier,
]);
