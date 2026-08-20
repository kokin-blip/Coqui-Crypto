import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@coqui/adapters': fileURLToPath(new URL('./packages/adapters/src/index.ts', import.meta.url)),
      '@coqui/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@coqui/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@coqui/observability': fileURLToPath(new URL('./packages/observability/src/index.ts', import.meta.url)),
      '@coqui/services': fileURLToPath(new URL('./packages/services/src/index.ts', import.meta.url)),
      '@coqui/storage': fileURLToPath(new URL('./packages/storage/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['.migration-source/**', 'node_modules/**', 'dist/**'],
    // Bound parallel filesystem/SQLite work so Windows CI does not starve
    // otherwise-fast suites behind the default five-second test timeout.
    maxWorkers: 8,
  },
});
