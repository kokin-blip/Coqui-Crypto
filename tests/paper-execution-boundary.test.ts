import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());

function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return files(child);
    return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name) ? [child] : [];
  });
}

describe('paper OMS production boundary', () => {
  it('allows the OMS value only inside PaperExecutionService', () => {
    const production = [
      ...files(join(root, 'apps/desktop/src')),
      ...files(join(root, 'packages/services/src')),
    ];
    const violations = production
      .filter((path) => !path.endsWith('/paper/oms.ts') && !path.endsWith('/paper/execution-service.ts'))
      .filter((path) => /\bPaperOmsService\b/u.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));
    expect(violations).toEqual([]);
  });

  it('does not export the OMS implementation from the services package', () => {
    const barrel = readFileSync(join(root, 'packages/services/src/paper/index.ts'), 'utf8');
    expect(barrel).not.toMatch(/export \* from ['"]\.\/oms/u);
    expect(barrel).not.toContain('PaperOmsService');
  });

  it('routes the scheduler through PaperExecutionService', () => {
    const runLoop = readFileSync(join(root, 'packages/services/src/paper/run-loop.ts'), 'utf8');
    expect(runLoop).toContain('new PaperExecutionService');
    expect(runLoop).not.toContain('runExecutionGates(');
    expect(runLoop).not.toContain('new PaperOmsService');
  });
});
