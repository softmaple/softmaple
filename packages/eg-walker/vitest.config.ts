import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
      thresholds: {
        lines: 75,
        functions: 85,
        branches: 55,
        statements: 75,
      },
    },
  },
});
