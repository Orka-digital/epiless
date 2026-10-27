import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'tests/backend/**/*.test.ts',
      'tests/extension/**/*.test.ts',
      'tests/operations/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 15000,
  },
});
