import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@coqui/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@coqui/observability': fileURLToPath(new URL('./packages/observability/src/index.ts', import.meta.url)),
      '@coqui/storage': fileURLToPath(new URL('./packages/storage/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['.migration-source/**', 'node_modules/**', 'dist/**'],
  },
});
