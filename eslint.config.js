import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const workspaceRoot = path.resolve('.').replaceAll('\\', '/');

function normalize(value) {
  return value.replaceAll('\\', '/');
}

function resolveImport(filename, source) {
  const aliases = {
    '@coqui/core': 'packages/core/src',
    '@coqui/adapters': 'packages/adapters/src',
    '@coqui/storage': 'packages/storage/src',
    '@coqui/services': 'packages/services/src',
    '@coqui/contracts': 'packages/contracts/src',
    '@coqui/observability': 'packages/observability/src',
    '@coqui/ui-kit': 'packages/ui-kit/src',
  };
  const alias = Object.entries(aliases).find(([name]) => source === name || source.startsWith(`${name}/`));
  if (alias) {
    const [name, target] = alias;
    return `${workspaceRoot}/${target}${source.slice(name.length)}`;
  }
  if (source.startsWith('.')) return normalize(path.resolve(path.dirname(filename), source));
  return source;
}

const architecturePlugin = {
  rules: {
    boundaries: {
      meta: { type: 'problem', schema: [], messages: { forbidden: '{{message}}' } },
      create(context) {
        const filename = normalize(context.filename);
        return {
          ImportDeclaration(node) {
            const source = String(node.source.value);
            const target = resolveImport(filename, source);
            const inCore = filename.includes('/packages/core/');
            const inServices = filename.includes('/packages/services/');
            const inAdapters = filename.includes('/packages/adapters/');
            const inContracts = filename.includes('/packages/contracts/');
            const inRenderer = filename.includes('/apps/desktop/src/renderer/');
            const inStrategy = filename.includes('/packages/core/src/strategies/');
            const inProductionWorkspace = filename.includes('/packages/') || filename.includes('/apps/');
            const nodeForbiddenInCore = ['node:fs', 'node:net', 'node:http'].includes(source);
            const runtimeForbiddenInCore = source === 'electron' || source === 'react';
            const otherWorkspaceTarget =
              target.startsWith(`${workspaceRoot}/packages/`) &&
              !target.startsWith(`${workspaceRoot}/packages/core/`);

            let message = null;
            if (inProductionWorkspace && target.includes('/benchmarks/language-spike/')) {
              message = 'production workspaces cannot import the quarantined language spike';
            } else if (inCore && (nodeForbiddenInCore || runtimeForbiddenInCore || otherWorkspaceTarget || target.includes('/apps/'))) {
              message = 'core must remain pure and cannot import runtime I/O, UI, apps, or another workspace package';
            } else if (inServices && (source === 'electron' || source === 'react')) {
              message = 'services cannot import Electron or React';
            } else if (
              inContracts &&
              (
                source === 'electron' ||
                source === 'react' ||
                ['/packages/services/', '/packages/storage/', '/packages/adapters/', '/apps/']
                  .some((part) => target.includes(part))
              )
            ) {
              message = 'contracts must remain transport-neutral and cannot import runtime implementation';
            } else if (inAdapters && target.includes('/packages/services/')) {
              message = 'adapters cannot import services';
            } else if (
              inRenderer &&
              ['/packages/services/', '/packages/storage/', '/packages/adapters/'].some((part) => target.includes(part))
            ) {
              message = 'the renderer can communicate only through CoquiClient';
            } else if (inStrategy && target.includes('/research/')) {
              message = 'core strategies cannot import the research sandbox';
            }

            if (message) context.report({ node, messageId: 'forbidden', data: { message } });
          },
        };
      },
    },
    'only-http-fetch': {
      meta: { type: 'problem', schema: [], messages: { forbidden: 'global fetch is allowed only in packages/adapters/src/http' } },
      create(context) {
        const filename = normalize(context.filename);
        const allowed = filename.includes('/packages/adapters/src/http/');
        return {
          CallExpression(node) {
            if (!allowed && node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },
    'service-import-limit': {
      meta: { type: 'problem', schema: [], messages: { tooMany: 'a service may import at most two other services' } },
      create(context) {
        const filename = normalize(context.filename);
        const ownMatch = filename.match(/\/packages\/services\/src\/([^/]+)/);
        const imports = new Set();
        return {
          ImportDeclaration(node) {
            if (!ownMatch) return;
            const target = resolveImport(filename, String(node.source.value));
            const targetMatch = target.match(/\/packages\/services\/src\/([^/]+)/);
            if (targetMatch?.[1] && targetMatch[1] !== ownMatch[1]) imports.add(targetMatch[1]);
          },
          'Program:exit'(node) {
            if (imports.size > 2) context.report({ node, messageId: 'tooMany' });
          },
        };
      },
    },
    'no-renderer-interval': {
      meta: { type: 'problem', schema: [], messages: { forbidden: 'renderer components and features cannot own setInterval' } },
      create(context) {
        const filename = normalize(context.filename);
        const guarded =
          filename.includes('/apps/desktop/src/renderer/components/') ||
          filename.includes('/apps/desktop/src/renderer/features/');
        return {
          CallExpression(node) {
            if (guarded && node.callee.type === 'Identifier' && node.callee.name === 'setInterval') {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },
    'no-core-wall-clock': {
      meta: { type: 'problem', schema: [], messages: { forbidden: 'core time must come from an injected Clock' } },
      create(context) {
        const inCore = normalize(context.filename).includes('/packages/core/');
        return {
          CallExpression(node) {
            if (
              inCore &&
              node.callee.type === 'MemberExpression' &&
              node.callee.object.type === 'Identifier' &&
              node.callee.object.name === 'Date' &&
              node.callee.property.type === 'Identifier' &&
              node.callee.property.name === 'now'
            ) {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      '.migration-source/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'benchmarks/language-spike/.venv/**',
      'benchmarks/language-spike/rust/index.js',
      'benchmarks/language-spike/rust/index.d.ts',
      'benchmarks/language-spike/rust/target/**',
    ],
  },
  {
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { architecture: architecturePlugin },
    rules: {
      'architecture/boundaries': 'error',
      'architecture/only-http-fetch': 'error',
      'architecture/service-import-limit': 'error',
      'architecture/no-renderer-interval': 'error',
      'architecture/no-core-wall-clock': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      'no-warning-comments': ['error', { terms: ['todo'], location: 'anywhere' }],
    },
  },
  {
    files: ['apps/desktop/src/renderer/components/**/*.tsx', 'apps/desktop/src/renderer/features/**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
);
