import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve,relative } from 'node:path';
import { dependencyManifest } from '../scripts/build-study-manifests.mjs';
const root=resolve('.'),entry='packages/services/src/paper/execution-remediation-shadow.ts';
describe('behavior dependency manifest',()=>{
  it('binds the ML worker boundary and inference implementation to the shadow candidate',()=>{
    const manifest=dependencyManifest(root,'apps/desktop/src/main/ml-signal-runtime.ts');
    expect(manifest.members.map(([file])=>file)).toContain('apps/desktop/src/main/ml-signal-worker-thread.ts');
    const changed=dependencyManifest(root,'apps/desktop/src/main/ml-signal-runtime.ts',(file,encoding)=>
      String(readFileSync(file,encoding as 'utf8'))+(relative(root,file)==='apps/desktop/src/main/ml-signal-worker-thread.ts'?'\n// worker test change':''));
    expect(changed.hash).not.toBe(manifest.hash);
  });

  it('covers signal, sizing, timestamp validation, venue parsers, costs, storage, and locking dependencies',()=>{
    const manifest=dependencyManifest(root,entry),members=manifest.members.map(([file])=>file);
    for(const required of ['packages/core/src/execution/remediation-planner.ts','packages/core/src/execution/remediation-book.ts',
      'packages/services/src/paper/parallel-signal.ts','packages/services/src/paper/parallel-paper-intraday.ts',
      'packages/adapters/src/coinbase/product-rules.ts','packages/storage/src/repositories/study-instances.ts','pnpm-lock.yaml'])
      expect(members).toContain(required);
    expect(members.some((file)=>file.includes('/renderer/'))).toBe(false);
    expect(members).not.toContain('packages/core/src/research/study-manifests.generated.ts');
  });
  it('invalidates relevant changes but ignores an unrelated renderer change and diagnostic manifest output',()=>{
    const base=dependencyManifest(root,entry);
    const mutate=(target:string)=>dependencyManifest(root,entry,(file,encoding)=>String(readFileSync(file,encoding as 'utf8'))+
      (relative(root,file)===target?'\n// test-only source change':''));
    expect(mutate('packages/core/src/execution/remediation-planner.ts').hash).not.toBe(base.hash);
    expect(mutate('packages/adapters/src/coinbase/product-rules.ts').hash).not.toBe(base.hash);
    expect(mutate('apps/desktop/src/renderer/app/ParallelPaperComparison.tsx').hash).toBe(base.hash);
    expect(mutate('packages/core/src/research/study-manifests.generated.ts').hash).toBe(base.hash);
  });
});
