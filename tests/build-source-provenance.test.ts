import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
const modulePath = '../apps/desktop/scripts/build-metadata.mjs';
const { sourceBuildDirty } = await import(modulePath);
function fixture(run: (root: string, generated: string, source: string) => void): void {
  const root = mkdtempSync(join(tmpdir(),'coqui-build-source-'));
  vi.stubEnv('GIT_DIR',undefined); vi.stubEnv('GIT_WORK_TREE',undefined);
  try {
    const generated = join(root,'packages/core/src/research/study-manifests.generated.ts');
    const source = join(root,'packages/core/src/fixture.ts');
    mkdirSync(join(root,'packages/core/src/research'),{recursive:true});
    writeFileSync(generated,'previous generated revision\n'); writeFileSync(source,'approved source\n');
    const git = (...args: string[]) => execFileSync('git',args,{cwd:root,stdio:'ignore'});
    git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
    run(root,generated,source);
  } finally { vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true}); }
}
describe('release source provenance', () => {
  it('rejects an unchanged generated manifest that belongs to an earlier revision', () => fixture((root) => {
    expect(sourceBuildDirty(root,'verified current generated revision\n')).toBe(true);
  }));
  it('accepts only the exact verified generated source as a clean derivation', () => fixture((root,generated) => {
    writeFileSync(generated,'verified current generated revision\n');
    expect(sourceBuildDirty(root,'verified current generated revision\n')).toBe(false);
    writeFileSync(generated,'unverified generated modification\n');
    expect(sourceBuildDirty(root,'verified current generated revision\n')).toBe(true);
  }));
  it('still detects tracked and untracked application changes beside verified generation', () => fixture((root,generated,source) => {
    writeFileSync(generated,'verified\n');writeFileSync(source,'changed source\n');
    expect(sourceBuildDirty(root,'verified\n')).toBe(true);
    writeFileSync(source,'approved source\n');writeFileSync(join(root,'packages/core/src/new.ts'),'unreviewed source\n');
    expect(sourceBuildDirty(root,'verified\n')).toBe(true);
  }));
});
