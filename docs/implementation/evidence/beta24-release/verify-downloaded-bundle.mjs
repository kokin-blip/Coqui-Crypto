import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const [bundle,workspace,receipt]=process.argv.slice(2).map(p=>resolve(p));
const repository=process.cwd(),require=createRequire(import.meta.url);
const {extractFile}=require(join(repository,'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/asar.js'));
const asar=join(bundle,'Contents/Resources/app.asar'),extract=path=>extractFile(asar,path),hash=data=>createHash('sha256').update(data).digest('hex');
const metadata=JSON.parse(extract('dist/main/build-info.json').toString());
const expected=JSON.parse(readFileSync(join(workspace,'apps/desktop/dist/main/build-info.json'),'utf8'));
assert.equal(metadata.version,'0.1.0-beta.24');assert.equal(metadata.sourceRevision,'b33ddcf6680f5973591f4c4d288117e8be0b6d36');
assert.equal(metadata.dirty,false);assert.equal(metadata.sourceHash,expected.sourceHash);
const core=extract('node_modules/@coqui/core/dist/research/study-manifests.generated.js').toString();
const compiledRevision=/STUDY_BUILD_REVISION\s*=\s*['"]([^'"]+)/.exec(core)?.[1];assert.equal(compiledRevision,metadata.sourceRevision);
assert.equal(JSON.parse(extract('node_modules/zod/package.json').toString()).version,'4.6.6');
const paths=['dist/main/index.js','dist/main/paper-reserve-runtime.js','dist/main/alpaca-performance-handlers.js','dist/main/parallel-paper-runtime.js','dist/preload/index.cjs','dist/renderer/index.html',
  ...readdirSync(join(workspace,'apps/desktop/dist/renderer/assets')).filter(p=>/\.(js|css)$/u.test(p)).sort().map(p=>'dist/renderer/assets/'+p),
  ...['storage/dist/repositories/account-capital-authority.js','core/dist/portfolio/capital-performance.js','services/dist/portfolio/paper-capital-evidence.js','services/dist/paper/parallel-paper-settlement.js','core/dist/research/study-manifests.generated.js'].map(p=>'node_modules/@coqui/'+p)];
const members=paths.map(path=>{const local=path.startsWith('dist/')?join(workspace,'apps/desktop',path):join(workspace,'packages',path.replace('node_modules/@coqui/',''));const digest=hash(extract(path));assert.equal(digest,hash(readFileSync(local)),path);return {path,sha256:digest};});
const signature=spawnSync('codesign',['--verify','--deep','--strict',bundle],{encoding:'utf8'});assert.equal(signature.status,0,signature.stderr);
const signatureInfo=spawnSync('codesign',['-dv',bundle],{encoding:'utf8'});assert.match(signatureInfo.stderr,/adhoc/u);
const plist=join(bundle,'Contents/Info.plist');
assert.equal(spawnSync('plutil',['-extract','NSAppTransportSecurity.NSAllowsArbitraryLoads','raw',plist],{encoding:'utf8'}).stdout.trim(),'false');
for(const key of ['NSCameraUsageDescription','NSMicrophoneUsageDescription'])assert.notEqual(spawnSync('plutil',['-extract',key,'raw',plist],{encoding:'utf8'}).status,0);
const directory=mkdtempSync(join(tmpdir(),'coqui-downloaded-smoke-')),env={...process.env,COQUI_DATA_DIR:directory};
delete env.COQUI_DB_PATH;delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
let smoke;
try{
  const run=spawnSync(join(bundle,'Contents/MacOS/Coqui'),['--packaged-smoke',`--user-data-dir=${directory}`],{env,encoding:'utf8',timeout:120000});
  writeFileSync(receipt.replace(/\.json$/u,'.log'),`${run.stdout??''}${run.stderr??''}`);
  smoke=JSON.parse(/COQUI_PACKAGED_SMOKE (\{.*\})/u.exec(run.stdout??'')?.[1]??'null');
  assert.equal(run.status,0);assert.equal(smoke?.opened,true);assert.equal(smoke?.schemaVersion,100);assert.equal(smoke?.workerLoaded,true);assert.equal(smoke?.provenanceVerified,true);assert.equal(smoke?.error,null);
}finally{rmSync(directory,{recursive:true,force:true});}
const result={bundle,metadata,compiledRevision,sourceHashMatchesLocal:true,zod:'4.6.6',adHocSignatureVerified:true,transportAndCapabilitiesVerified:true,members,smoke,disposableProfile:true,actualProfilesTouched:false};
writeFileSync(receipt,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({verified:true,version:metadata.version,revision:compiledRevision,members:members.length,smoke}));
