import { Buffer } from 'node:buffer';
/** Disposable synthetic end-to-end CLI check; never opens the user's profile. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openDatabase, createFileProfileManifestStore } from '../packages/storage/dist/index.js';
import { capitalHash } from '../packages/core/dist/index.js';
const helper=stripTypeScriptTypes(readFileSync('tests/helpers/capital-replay.ts','utf8'),{mode:'strip'}).replace("'@coqui/core'",JSON.stringify(pathToFileURL(resolve('packages/core/dist/index.js')).href));
const {replayFixture}=await import('data:text/javascript;base64,'+Buffer.from(helper).toString('base64'));
const directory=mkdtempSync(join(tmpdir(),'coqui-p4-cli-')),checks=[],output=resolve('docs/implementation/evidence/p4-replay-2026-10-23');
function check(name,passed){checks.push({name,passed});if(!passed)throw new Error(name);}
const cli=(command,args=[])=>execFileSync(process.execPath,['scripts/research-capital-replay.mjs',command,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
try{
 mkdirSync(join(directory,'reports'));const id='00000000-0000-4000-8000-000000000004',filename=`wallet-${id}.db`;
 for(const file of ['coqui.db',filename])openDatabase(join(directory,file)).close();
 const manifest=join(directory,'profiles.json'),store=createFileProfileManifestStore(manifest);
 const profiles=[{id:'main',name:'Main',color:'#60a5fa',icon:'wallet',dbFilename:'coqui.db',createdAt:1,lastOpenedAt:1,order:0},{id,name:'Offline',color:'#60a5fa',icon:'wallet',dbFilename:filename,createdAt:1,lastOpenedAt:1,order:1}];
 check('existing inactive profile fixture',store.replace(null,{version:1,activeProfileId:'main',profiles}).ok);
 const runtime=JSON.parse(cli('--identity')),{spec:base,tape}=replayFixture(),body=JSON.stringify(tape);
 writeFileSync(join(directory,'tape.json'),body);
 const input={version:1,exposure:'synthetic',provider:'coinbase',fromMs:base.fromMs,toMs:base.toMs,warmupFromMs:base.warmupFromMs,kind:'json_tape',file:{path:'tape.json',bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')},archives:[]};
 writeFileSync(join(directory,'input.json'),JSON.stringify(input));
 const spec={...base,...runtime,originProfileId:id,workspaceId:'synthetic-cli',sourceRefs:[capitalHash(input)]};writeFileSync(join(directory,'spec.json'),JSON.stringify(spec));
 const args=[`--spec=${join(directory,'spec.json')}`,`--profile-manifest=${manifest}`,`--profile-id=${id}`,`--database=${join(directory,filename)}`,`--input-manifest=${join(directory,'input.json')}`,`--output-root=${join(directory,'reports')}`];
 check('validate reads no data bodies',JSON.parse(cli('validate',args)).dataBodiesRead===false);
 check('documented argument separator is accepted',JSON.parse(cli('--',['validate',...args])).dataBodiesRead===false);
 const first=JSON.parse(cli('replay',args));check('real CLI independently retains all 36 cells',first.cells===36);
 rmSync(join(directory,'tape.json'));
 const retry=JSON.parse(cli('replay',args)),report=JSON.parse(cli('report',args));check('exact retry and report require no tape reload',retry.id===first.id&&report.id===first.id);
 check('self-contained report preserves exact spec and all cells',capitalHash(JSON.parse(readFileSync(join(first.directory,'spec.json'),'utf8')))===first.specHash&&JSON.parse(readFileSync(join(first.directory,'result.json'),'utf8')).cells.length===36);
 check('CSV retains complete grid and arms',readFileSync(join(first.directory,'summary.csv'),'utf8').trim().split('\n').length===37);
 const db=openDatabase(join(directory,filename),{skipMigrations:true});
 try{const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'capital_%' OR name LIKE 'paper_%' OR name='research_preregistrations')").all();check('no financial, paper or registration rows',tables.every(({name})=>Number(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n)===0));
 check('only dedicated P4 integrity kinds written',db.prepare("SELECT DISTINCT kind FROM research_integrity_events").all().every(({kind})=>kind.startsWith('capital_replay_')));
 }finally{db.close();}
 const current=store.read();store.replace(current.value.revision,{...current.value.manifest,activeProfileId:id});let refused=false;try{cli('replay',args);}catch{refused=true;}check('active profile refused by actual CLI',refused);
 mkdirSync(output,{recursive:true});writeFileSync(join(output,'cli-smoke.json'),JSON.stringify({synthetic:true,accountAccess:false,runtime,resultId:first.id,checks},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,passed:true,resultId:first.id}));
}finally{rmSync(directory,{recursive:true,force:true});}
