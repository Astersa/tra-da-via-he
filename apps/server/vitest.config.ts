import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Shared PostgreSQL database: test files must run one at a time.
    fileParallelism: false,
    // Loads .env.test into each worker (DATABASE_URL on port 5433).
    setupFiles: ['./test/helpers/env.ts'],
    // Applies pending migrations to the test DB once per run (same as db:migrate:test).
    globalSetup: ['./test/helpers/global-setup.ts'],
  },
});
