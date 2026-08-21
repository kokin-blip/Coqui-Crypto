import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Renderer build only. The main process and preload are built by `tsc -b` and
 * esbuild respectively; nothing here touches them.
 */
export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome150',
    // The CSP forbids inline script and style, so nothing may be inlined into
    // the HTML document — including the small assets Vite would inline by
    // default. `assetsInlineLimit: 0` keeps every asset a separate 'self' file.
    assetsInlineLimit: 0,
    sourcemap: true,
    reportCompressedSize: true,
  },
  server: { port: 5173, strictPort: true },
});
