import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildStudyManifests, renderStudyManifestSource } from '../../../scripts/build-study-manifests.mjs';
const sourcePaths=['packages','apps','scripts','pnpm-lock.yaml','package.json','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','tsconfig.check.json'];
export function sourceBuildDirty(repository, expectedGeneratedSource) {
  const git = (...args) => execFileSync('git',args,{cwd:repository,encoding:'utf8'});
  const generated = 'packages/core/src/research/study-manifests.generated.ts';
  const path = join(repository,generated);
  const verified = existsSync(path) && readFileSync(path,'utf8') === expectedGeneratedSource;
  const changed = git('diff','--name-only','-z','HEAD','--',...sourcePaths).split('\0').filter(Boolean);
  const untracked = git('ls-files','--others','--exclude-standard','-z','--',...sourcePaths).split('\0').filter(Boolean);
  return !verified || untracked.length > 0 || changed.some(file => file !== generated);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
const root = dirname(dirname(fileURLToPath(import.meta.url))), repository = dirname(dirname(root));
const git = (...args) => execFileSync('git',args,{cwd:repository,encoding:'utf8'}).trim();
const files = git('ls-files','--cached','--others','--exclude-standard','-z',...sourcePaths).split('\0').filter(p => p && !p.includes('/dist/')).sort();
const hash = createHash('sha256');
for (const path of files) { hash.update(path); hash.update('\0'); hash.update(readFileSync(join(repository,path))); }
const pkg = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
mkdirSync(join(root,'dist/main'),{recursive:true});
const revision = git('rev-parse','HEAD');
const expected = renderStudyManifestSource(buildStudyManifests(repository),createHash('sha256').update(readFileSync(join(repository,'pnpm-lock.yaml'))).digest('hex'),revision);
writeFileSync(join(root,'dist/main/build-info.json'),JSON.stringify({ version:pkg.version, sourceRevision:revision,
  dirty: sourceBuildDirty(repository,expected),
  sourceHash:hash.digest('hex'), channel:pkg.version.includes('beta')?'beta-candidate':'unspecified', builtAtMs:Date.now() },null,2)+'\n');
}
