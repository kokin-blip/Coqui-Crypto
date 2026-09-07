import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import {
  CONTENT_SECURITY_POLICY,
  rendererContentSecurityPolicy,
} from './src/main/security.js';

const root = dirname(fileURLToPath(import.meta.url));
const DEV_RENDERER_ORIGIN = 'http://127.0.0.1:5173';

/**
 * Renderer build only. The main process and preload are built by `tsc -b` and
 * esbuild respectively; nothing here touches them.
 */
export default defineConfig(({ command }) => ({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [
    {
      name: 'coqui-renderer-csp',
      enforce: 'pre',
      transformIndexHtml(html) {
        const policy = command === 'serve'
          ? rendererContentSecurityPolicy(DEV_RENDERER_ORIGIN)
          : CONTENT_SECURITY_POLICY;
        return html.replace('__COQUI_RENDERER_CSP__', policy);
      },
    },
    react(),
    tailwindcss(),
  ],
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
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
