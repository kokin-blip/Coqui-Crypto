import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const cwd = process.cwd();
const eslint = new ESLint({ cwd });

interface BoundaryCase {
  readonly name: string;
  readonly filePath: string;
  readonly code: string;
  readonly ruleId: string;
}

const cases: readonly BoundaryCase[] = [
  {
    name: 'rejects Electron in core',
    filePath: 'packages/core/src/violation.ts',
    code: "import { app } from 'electron';\nexport const value = app.name;\n",
    ruleId: 'architecture/boundaries',
  },
  {
    name: 'rejects another workspace package in core',
    filePath: 'packages/core/src/violation.ts',
    code: "import '@coqui/storage';\n",
    ruleId: 'architecture/boundaries',
  },
  {
    name: 'rejects global fetch outside the HTTP adapter',
    filePath: 'packages/adapters/src/coinbase/violation.ts',
    code: "export const request = () => fetch('https://example.invalid');\n",
    ruleId: 'architecture/only-http-fetch',
  },
  {
    name: 'rejects three service dependencies',
    filePath: 'packages/services/src/research/violation.ts',
    code: "import '../market-data/index.js';\nimport '../portfolio/index.js';\nimport '../paper/index.js';\n",
    ruleId: 'architecture/service-import-limit',
  },
  {
    name: 'rejects component-owned intervals',
    filePath: 'apps/desktop/src/renderer/components/Violation.tsx',
    code: 'export const start = () => setInterval(() => undefined, 1_000);\n',
    ruleId: 'architecture/no-renderer-interval',
  },
  {
    name: 'rejects wall-clock access in core',
    filePath: 'packages/core/src/time/violation.ts',
    code: 'export const current = () => Date.now();\n',
    ruleId: 'architecture/no-core-wall-clock',
  },
];

describe('architecture boundaries', () => {
  for (const boundary of cases) {
    it(boundary.name, async () => {
      const [result] = await eslint.lintText(boundary.code, {
        filePath: path.join(cwd, boundary.filePath),
      });
      expect(result?.messages.some((message) => message.ruleId === boundary.ruleId)).toBe(true);
    });
  }

  it('allows fetch inside the HTTP adapter', async () => {
    const [result] = await eslint.lintText(
      "export const request = () => fetch('https://example.invalid');\n",
      { filePath: path.join(cwd, 'packages/adapters/src/http/request.ts') },
    );
    expect(result?.errorCount).toBe(0);
  });
});

