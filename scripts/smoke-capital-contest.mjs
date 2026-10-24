import {Buffer} from 'node:buffer';
/** Disposable synthetic CLI evidence; no installed profile, provider or study access. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openDatabase,createFileProfileManifestStore} from '../packages/storage/dist/index.js';
import {capitalHash} from '../packages/core/dist/index.js';
const core=JSON.stringify(pathToFileURL(resolve('packages/core/dist/index.js')).href),p4=stripTypeScriptTypes(readFileSync('tests/helpers/capital-replay.ts','utf8'),{mode:'strip'}).replace("'@coqui/core'",core),p4url='data:text/javascript;base64,'+Buffer.from(p4).toString('base64');
const p5=stripTypeScriptTypes(readFileSync('tests/helpers/capital-contest.ts','utf8'),{mode:'strip'}).replace("'@coqui/core'",core).replace("'./capital-replay.js'",JSON.stringify(p4url));const {contestFixture}=await import('data:text/javascript;base64,'+Buffer.from(p5).toString('base64'));
const directory=mkdtempSync(join(tmpdir(),'coqui-p5-cli-')),checks=[],output=resolve('docs/implementation/evidence/p5-contest-2026-10-24');
const check=(name,passed)=>{checks.push({name,passed});if(!passed)throw new Error(name);};
const cli=(command,args=[])=>execFileSync(process.execPath,['scripts/research-capital-contest.mjs',command,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
try{
 mkdirSync(join(directory,'reports'));const id='00000000-0000-4000-8000-000000000005',filename=`wallet-${id}.db`;for(const file of ['coqui.db',filename])openDatabase(join(directory,file)).close();
 const profiles=join(directory,'profiles.json'),store=createFileProfileManifestStore(profiles);check('existing inactive profile',store.replace(null,{version:1,activeProfileId:'main',profiles:[{id:'main',name:'Main',color:'#60a5fa',icon:'wallet',dbFilename:'coqui.db',createdAt:1,lastOpenedAt:1,order:0},{id,name:'Offline',color:'#60a5fa',icon:'wallet',dbFilename:filename,createdAt:1,lastOpenedAt:1,order:1}]}).ok);
 const runtime=JSON.parse(cli('identity')),{manifest:base,data}=contestFixture(1),body=JSON.stringify(data);writeFileSync(join(directory,'panel.json'),body);
 const file={version:1,kind:'json_panel',exposure:'synthetic',provider:'coinbase',fromMs:base.replay.fromMs,toMs:base.replay.toMs,warmupFromMs:base.replay.warmupFromMs,file:{path:'panel.json',bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}};writeFileSync(join(directory,'input.json'),JSON.stringify(file));
 const manifest={...base,replay:{...base.replay,...runtime,originProfileId:id,workspaceId:'synthetic-cli'},sourceRefs:[capitalHash(file)]};writeFileSync(join(directory,'contest.json'),JSON.stringify(manifest));
 const args=[`--manifest=${join(directory,'contest.json')}`,`--profile-manifest=${profiles}`,`--profile-id=${id}`,`--database=${join(directory,filename)}`,`--input-manifest=${join(directory,'input.json')}`,`--output-root=${join(directory,'reports')}`];
 check('validate does not read data bodies',JSON.parse(cli('validate',args)).dataBodiesRead===false);check('documented separator accepted',JSON.parse(cli('--',['validate',...args])).cells===72);
 const first=JSON.parse(cli('run',args));check('real offline result is none and grants no authority',first.choice==='none'&&first.confirmatoryEligible===false&&first.liveExecutionPermitted===false);
 rmSync(join(directory,'panel.json'));const retry=JSON.parse(cli('run',args)),report=JSON.parse(cli('report',args));check('exact retry/report do not reload the panel',retry.id===first.id&&report.id===first.id);
 const saved=JSON.parse(readFileSync(join(first.directory,'result.json'),'utf8'));check('export binds every complete base cell hash',saved.cellIds.length===72&&saved.cellHashes.length===72&&capitalHash(JSON.parse(readFileSync(join(first.directory,'manifest.json'),'utf8')))===saved.manifestHash);
 const db=openDatabase(join(directory,filename),{skipMigrations:true});try{const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'capital_%' OR name LIKE 'paper_%' OR name='research_preregistrations')").all();check('zero financial/paper/registration rows',tables.every(({name})=>Number(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n)===0));check('only dedicated contest integrity kinds',db.prepare('SELECT DISTINCT kind FROM research_integrity_events').all().every(({kind})=>kind.startsWith('contest_')));}finally{db.close();}
 const current=store.read();store.replace(current.value.revision,{...current.value.manifest,activeProfileId:id});let refused=false;try{cli('run',args);}catch{refused=true;}check('active profile refused by actual CLI',refused);
 mkdirSync(output,{recursive:true});writeFileSync(join(output,'cli-smoke.json'),JSON.stringify({synthetic:true,accountAccess:false,runtime,resultId:first.id,checks},null,2)+'\n');console.log(JSON.stringify({checks:checks.length,passed:true,resultId:first.id}));
}finally{rmSync(directory,{recursive:true,force:true});}
