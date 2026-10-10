import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url))), repository = dirname(dirname(root));
const git = (...args) => execFileSync('git',args,{cwd:repository,encoding:'utf8'}).trim();
const sourcePaths=['packages','apps','scripts','pnpm-lock.yaml','package.json','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','tsconfig.check.json'];
const files = git('ls-files','--cached','--others','--exclude-standard','-z',...sourcePaths).split('\0').filter(p => p && !p.includes('/dist/')).sort();
const hash = createHash('sha256');
for (const path of files) { hash.update(path); hash.update('\0'); hash.update(readFileSync(join(repository,path))); }
const pkg = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
mkdirSync(join(root,'dist/main'),{recursive:true});
writeFileSync(join(root,'dist/main/build-info.json'),JSON.stringify({ version:pkg.version, sourceRevision:git('rev-parse','HEAD'),
  dirty: Boolean(git('status','--porcelain','--untracked-files=normal','--',...sourcePaths)),
  sourceHash:hash.digest('hex'), channel:pkg.version.includes('beta')?'beta-candidate':'unspecified', builtAtMs:Date.now() },null,2)+'\n');
