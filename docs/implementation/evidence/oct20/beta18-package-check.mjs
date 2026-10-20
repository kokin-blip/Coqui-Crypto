import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { URL } from 'node:url';
const repo=resolve(new URL('../../../..',import.meta.url).pathname);
const bundle=process.argv[2]??join(repo,'apps/desktop/release/local-beta18/mac-arm64/Coqui.app');
const label=process.argv[3]??'packaged';
const asar=createRequire(join(repo,'package.json'))('./node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/asar.js');
const archive=join(bundle,'Contents/Resources/app.asar');
const hash=value=>createHash('sha256').update(value).digest('hex');
const members=['dist/main/build-info.json','node_modules/@coqui/services/dist/paper/parallel-paper-minor-recovery.js',
  'node_modules/@coqui/services/dist/paper/parallel-paper-recovery.js','node_modules/@coqui/services/dist/paper/parallel-paper-utils.js',
  'node_modules/@coqui/services/dist/paper/parallel-paper-attention.js','node_modules/@coqui/contracts/dist/schemas/parallel-paper.js'];
const build=JSON.parse(asar.extractFile(archive,members[0]).toString());
assert.equal(build.version,'0.1.0-beta.18');
const identities=members.map(path=>({path,sha256:hash(asar.extractFile(archive,path))}));
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
const temporary=mkdtempSync(join(tmpdir(),'coqui-beta18-smoke-'));
const run=spawnSync(join(bundle,'Contents/MacOS/Coqui'),['--packaged-smoke',`--user-data-dir=${temporary}`],
  {encoding:'utf8',timeout:45000,env:{...process.env,COQUI_DATA_DIR:temporary}});
const output=`${run.stdout??''}${run.stderr??''}`;
writeFileSync(join(repo,`docs/implementation/evidence/oct20/beta18-${label}-smoke.log`),output);
assert.equal(run.status,0,output);
const smoke=JSON.parse(/COQUI_PACKAGED_SMOKE (\{.*\})/u.exec(output)?.[1]??'null');
assert.equal(smoke.opened,true);assert.equal(smoke.workerLoaded,true);assert.equal(smoke.schemaVersion,95);
const result={bundle,build,asarSha256:hash(readFileSync(archive)),identities,signatureVerified:true,smoke,actualProfileAccess:false};
writeFileSync(join(repo,`docs/implementation/evidence/oct20/beta18-${label}-checks.json`),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
