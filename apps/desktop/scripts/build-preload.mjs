import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * A sandboxed preload cannot `require` arbitrary packages — only `electron` and
 * a small polyfilled subset are available — so the preload and everything it
 * imports (the channel registry and its Zod schemas) must arrive as one
 * CommonJS file. That is a hard consequence of `sandbox: true`, not a
 * packaging preference: dropping the bundle would mean dropping the sandbox.
 */
await build({
  entryPoints: [join(root, 'src/preload/index.ts')],
  outfile: join(root, 'dist/preload/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  // Provided by the host at runtime; bundling it would shadow the real module.
  external: ['electron'],
  minify: false,
  sourcemap: true,
  logLevel: 'warning',
});
