import { Buffer } from 'node:buffer';
/** Native QA on disposable synthetic evidence; no owner profile access. */
import {app,BrowserWindow,ipcMain,shell} from 'electron';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {capitalHash} from '@coqui/core';
import {openDatabase,saveReplaySpec,appendReplayRecord} from '@coqui/storage';
import {runCapitalReplay} from '@coqui/services';
import {seedCoinbaseSmokeProfile} from './coinbase-settings-smoke.mjs';
import {assertNoTextClipping} from './visual-overflow-audit.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),repository=dirname(dirname(root)),output=join(repository,'docs/implementation/evidence/p4-replay-2026-10-23/ui');
const directory=mkdtempSync(join(tmpdir(),'coqui-p4-native-'));
app.setPath('userData',join(directory,'browser'));app.setPath('sessionData',join(directory,'browser'));
const {createRuntimeProfileController}=await import('../dist/main/profile-runtime.js'),{createDispatcher}=await import('../dist/main/dispatch.js'),{applyWindowHardening,WEB_PREFERENCES}=await import('../dist/main/security.js');
let runtime,database,window;const checks=[],rendererErrors=[],browserNotices=[];
function check(name,passed,detail=''){checks.push({name,passed,detail});console.log(`${passed?'PASS':'FAIL'} ${name} ${detail}`);if(!passed)throw new Error(name);}
const js=source=>window.webContents.executeJavaScript(source);
async function waitFor(source){for(let i=0;i<100;i++){if(await js(source))return;await delay(100);}throw new Error(`P4 UI wait: ${source}`);}
async function run(){
 mkdirSync(output,{recursive:true});globalThis.WebSocket=class{close(){}send(){}};globalThis.fetch=async()=>new globalThis.Response('{}',{status:503});
 await seedCoinbaseSmokeProfile(directory);database=openDatabase(join(directory,'coqui.db'));
 const helper=stripTypeScriptTypes(readFileSync(join(repository,'tests/helpers/capital-replay.ts'),'utf8'),{mode:'strip'}).replace("'@coqui/core'",JSON.stringify(pathToFileURL(join(repository,'packages/core/dist/index.js')).href));
 const {replayFixture}=await import('data:text/javascript;base64,'+Buffer.from(helper).toString('base64'));
 const {spec:base,tape}=replayFixture(),spec={...base,originProfileId:'main',workspaceId:'synthetic-native'};
 const failed={...spec,pathId:'synthetic-interrupted'},failedHash=saveReplaySpec(failed,1,database);
 appendReplayRecord(failedHash,'capital_replay_attempt','interrupted-native',{synthetic:true},1,database);
 appendReplayRecord(failedHash,'capital_replay_interrupted','interrupted-native',{reason:'replay_cancelled'},2,database);
 await runCapitalReplay({spec,loadTape:async()=>tape,context:{profileId:'main',workspaceId:spec.workspaceId,assertCurrent(){}},runtime:{codeRevision:spec.codeRevision,sourceManifestHash:spec.sourceManifestHash,lockfileHash:spec.lockfileHash},now:()=>3,retry:false},database);
 const runId=capitalHash(spec);runtime=createRuntimeProfileController({dataDirectory:directory,legacyDatabaseFilename:'coqui.db',disableScheduler:true,runtime:{}});
 const dispatch=createDispatcher({handlers:()=>runtime.handlers()});await dispatch('app.onboarding.skip',{commandId:globalThis.crypto.randomUUID()});
 ipcMain.handle('coqui:query',async(_event,channel,payload)=>dispatch(channel,payload));
 const entry=join(root,'dist/renderer/index.html');window=new BrowserWindow({show:true,width:1440,height:1000,useContentSize:true,webPreferences:{...WEB_PREFERENCES,preload:join(root,'dist/preload/index.cjs'),backgroundThrottling:false}});
 window.webContents.on('console-message',event=>{if(event.message==="The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.")browserNotices.push(event.message);else if(event.level==='error')rendererErrors.push(event.message);});
 applyWindowHardening(window.webContents,pathToFileURL(entry).href,shell);let loaded=false;
 for(const [name,theme,width,height,zoom] of [['desktop-dark','dark',1440,1000,1],['narrow-light','light',640,900,1],['contrast-zoom','high_contrast',1280,1000,2]]){
  await dispatch('accounts.settings.set',{commandId:globalThis.crypto.randomUUID(),patch:{theme,density:'compact',motion:'none'}});window.setContentSize(width,height);window.webContents.setZoomFactor(zoom);
  if(loaded){const finished=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reload();await finished;}else{await window.loadFile(entry,{hash:'/research'});loaded=true;}
  window.focus();window.webContents.focus();await waitFor(`document.querySelector('.capital-replay table tbody')?.children.length===36`);
  check(`${name}: full grid and unavailable annualization`,await js(`document.querySelector('.capital-replay').innerText.includes('36 declared cells')&&document.querySelector('.capital-replay-selection').innerText.includes('Unavailable')`));
  await js(`document.querySelector('.capital-replay h2').scrollIntoView({block:'start'})`);await assertNoTextClipping(window.webContents,`p4-${name}-grid`);if(!process.argv.includes('--checks-only'))writeFileSync(join(output,`${name}-grid.png`),(await window.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.capital-replay button[aria-label="Inspect policy at 500 USD, base"]').focus()`);window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await waitFor(`document.querySelector('.capital-replay-selection h3')?.innerText.includes('$500')`);
  await js(`document.querySelector('.capital-replay-selection').scrollIntoView({block:'start'})`);await assertNoTextClipping(window.webContents,`p4-${name}-selection`);if(!process.argv.includes('--checks-only'))writeFileSync(join(output,`${name}-selection.png`),(await window.webContents.capturePage()).toPNG());
  check(`${name}: simulated receipts and sleeve scope`,await js(`document.querySelector('.capital-replay-selection').innerText.includes('Simulated net user receipts')&&document.querySelector('.capital-replay-selection').innerText.includes('Active-sleeve TWR')`));
  await js(`document.querySelector('.capital-replay [aria-label="About Active-sleeve TWR"]').focus()`);window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await waitFor(`document.querySelector(':popover-open')?.innerText.includes('total managed equity')`);
  const box=await js(`(()=>{const r=document.querySelector(':popover-open').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
  check(`${name}: keyboard help fits viewport`,box.left>=0&&box.right<=box.width&&box.top>=0&&box.bottom<=box.height,JSON.stringify(box));await delay(150);if(!process.argv.includes('--checks-only'))writeFileSync(join(output,`${name}-help.png`),(await window.webContents.capturePage()).toPNG());
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await waitFor(`!document.querySelector(':popover-open')`);check(`${name}: help returns focus`,await js(`document.activeElement?.getAttribute('aria-label')==='About Active-sleeve TWR'`));
 }
 check('period and funding scopes are explicit',await js(`document.querySelector('.capital-replay').innerText.includes('Period')&&document.querySelector('.capital-replay-selection').innerText.includes('External contributions')&&document.querySelector('.capital-replay-selection').innerText.includes('Net external outflows')`));
 const snapshot=()=>JSON.stringify(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,database.prepare(`SELECT * FROM ${name}`).all()]));
 const before=snapshot(),catalog=await js(`window.coqui.query('research.capital-replay.runs',{limit:100})`),detail=await js(`window.coqui.query('research.capital-replay.detail',${JSON.stringify({runId,cellId:null,page:0,limit:2})})`);
 check('production preload reads bounded results',catalog.status==='ok'&&catalog.value.runs.length===2&&detail.status==='ok'&&detail.value.traces.length===2&&detail.value.hasMore);
 const failedResult=await dispatch('research.capital-replay.detail',{runId:failedHash,cellId:null,page:0,limit:1});check('interruption differs from zero return',failedResult.status==='ok'&&failedResult.value.run.status==='interrupted'&&failedResult.value.cells.length===0);
 check('read routes leave all database rows unchanged',before===snapshot());check('no run or financial controls',await js(`![...document.querySelectorAll('.capital-replay button')].some(b=>/^(Run|Adopt|Enable|Withdraw|Execute|Commit)/i.test(b.innerText))`));
 const gate=await dispatch('risk.evidence-gate',{});check('live authority remains disabled',gate.status==='ok'&&gate.value.liveExecutionPermitted===false);check('no renderer errors',rendererErrors.length===0,rendererErrors.join('; '));
 writeFileSync(join(output,'smoke.json'),JSON.stringify({synthetic:true,accountAccess:false,runId,checks,rendererErrors,browserNotices},null,2)+'\n');
}
app.whenReady().then(run).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{window?.destroy();database?.close();runtime?.dispose();rmSync(directory,{recursive:true,force:true});app.exit(process.exitCode??0);});
