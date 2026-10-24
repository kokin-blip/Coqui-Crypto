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
import {openDatabase,saveContestManifest,appendContestRecord} from '@coqui/storage';
import {runCapitalContest} from '@coqui/services';
import {seedCoinbaseSmokeProfile} from './coinbase-settings-smoke.mjs';
import {assertNoTextClipping} from './visual-overflow-audit.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),repository=dirname(dirname(root)),output=join(repository,'docs/implementation/evidence/p5-contest-2026-10-24/ui');
const directory=mkdtempSync(join(tmpdir(),'coqui-p5-native-'));
app.setPath('userData',join(directory,'browser'));app.setPath('sessionData',join(directory,'browser'));
const {createRuntimeProfileController}=await import('../dist/main/profile-runtime.js'),{createDispatcher}=await import('../dist/main/dispatch.js'),{applyWindowHardening,WEB_PREFERENCES}=await import('../dist/main/security.js');
let runtime,database,window;const checks=[],rendererErrors=[],browserNotices=[];
function check(name,passed,detail=''){checks.push({name,passed,detail});console.log(`${passed?'PASS':'FAIL'} ${name} ${detail}`);if(!passed)throw new Error(name);}
const js=source=>window.webContents.executeJavaScript(source);
async function waitFor(source){for(let i=0;i<100;i++){if(await js(source))return;await delay(100);}throw new Error(`P5 UI wait: ${source}`);}
async function run(){
 mkdirSync(output,{recursive:true});globalThis.WebSocket=class{close(){}send(){}};globalThis.fetch=async()=>new globalThis.Response('{}',{status:503});
 await seedCoinbaseSmokeProfile(directory);database=openDatabase(join(directory,'coqui.db'));
 const core=JSON.stringify(pathToFileURL(join(repository,'packages/core/dist/index.js')).href),p4=stripTypeScriptTypes(readFileSync(join(repository,'tests/helpers/capital-replay.ts'),'utf8'),{mode:'strip'}).replace("'@coqui/core'",core),p4url='data:text/javascript;base64,'+Buffer.from(p4).toString('base64');
 const helper=stripTypeScriptTypes(readFileSync(join(repository,'tests/helpers/capital-contest.ts'),'utf8'),{mode:'strip'}).replace("'@coqui/core'",core).replace("'./capital-replay.js'",JSON.stringify(p4url));
 const {contestFixture}=await import('data:text/javascript;base64,'+Buffer.from(helper).toString('base64'));
 const {manifest:base,data}=contestFixture(1),manifest={...base,replay:{...base.replay,originProfileId:'main',workspaceId:'synthetic-native'}};
 const failed={...manifest,replay:{...manifest.replay,pathId:'synthetic-interrupted'}},failedHash=saveContestManifest(failed,1,database);
 appendContestRecord(failedHash,'contest_attempt','interrupted-native',{synthetic:true},1,database);appendContestRecord(failedHash,'contest_interrupted','interrupted-native',{reason:'contest_cancelled'},2,database);
 await runCapitalContest({manifest,loadData:async()=>data,context:{profileId:'main',workspaceId:manifest.replay.workspaceId,assertCurrent(){}},runtime:{codeRevision:manifest.replay.codeRevision,sourceManifestHash:manifest.replay.sourceManifestHash,lockfileHash:manifest.replay.lockfileHash},now:()=>3,resume:false},database);
 const runId=capitalHash(manifest);runtime=createRuntimeProfileController({dataDirectory:directory,legacyDatabaseFilename:'coqui.db',disableScheduler:true,runtime:{}});
 const dispatch=createDispatcher({handlers:()=>runtime.handlers()});await dispatch('app.onboarding.skip',{commandId:globalThis.crypto.randomUUID()});
 ipcMain.handle('coqui:query',async(_event,channel,payload)=>dispatch(channel,payload));
 const entry=join(root,'dist/renderer/index.html');window=new BrowserWindow({show:true,width:1440,height:1000,useContentSize:true,webPreferences:{...WEB_PREFERENCES,preload:join(root,'dist/preload/index.cjs'),backgroundThrottling:false}});
 window.webContents.on('console-message',event=>{if(event.message==="The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.")browserNotices.push(event.message);else if(event.level==='error')rendererErrors.push(event.message);});
 applyWindowHardening(window.webContents,pathToFileURL(entry).href,shell);let loaded=false;
 for(const [name,theme,width,height,zoom] of [['desktop-dark','dark',1440,1000,1],['narrow-light','light',640,900,1],['contrast-zoom','high_contrast',1280,1000,2]]){
  await dispatch('accounts.settings.set',{commandId:globalThis.crypto.randomUUID(),patch:{theme,density:'compact',motion:'none'}});window.setContentSize(width,height);window.webContents.setZoomFactor(zoom);
  if(loaded){const finished=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reload();await finished;}else{await window.loadFile(entry,{hash:'/research'});loaded=true;}
  window.focus();window.webContents.focus();await waitFor(`document.querySelector('.capital-contest table tbody')?.children.length===50`);
  check(`${name}: complete inventory and none`,await js(`document.querySelector('.capital-contest').innerText.includes('72/72 cells')&&document.querySelector('.capital-contest').innerText.includes('Research choice: none')`));
  await js(`document.querySelector('.capital-contest h2').scrollIntoView({block:'start'})`);await assertNoTextClipping(window.webContents,`p5-${name}-grid`);if(!process.argv.includes('--checks-only'))writeFileSync(join(output,`${name}-grid.png`),(await window.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.capital-contest button[aria-label="Inspect T1:base:500"]').focus()`);window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await waitFor(`document.querySelector('.capital-contest').innerText.includes('T1:base:500 · 1 decisions')`);
  await js(`document.querySelector('.capital-contest h3').scrollIntoView({block:'start'})`);
  await js(`document.querySelector('.capital-contest [aria-label="About Research choice"]').focus()`);window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await waitFor(`document.querySelector(':popover-open')?.innerText.includes('numerical leader')`);
  const box=await js(`(()=>{const r=document.querySelector(':popover-open').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
  check(`${name}: keyboard help fits viewport`,box.left>=0&&box.right<=box.width&&box.top>=0&&box.bottom<=box.height,JSON.stringify(box));if(!process.argv.includes('--checks-only'))writeFileSync(join(output,`${name}-help.png`),(await window.webContents.capturePage()).toPNG());
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await waitFor(`!document.querySelector(':popover-open')`);
  check(`${name}: help returns keyboard focus`,await js(`document.activeElement?.getAttribute('aria-label')==='About Research choice'`));
  await js(`document.querySelector('.capital-contest-selection').open=true;document.querySelector('.capital-contest-selection').scrollIntoView({block:'start',behavior:'instant'})`);await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await assertNoTextClipping(window.webContents,`p5-${name}-selection`);if(!process.argv.includes('--checks-only'))writeFileSync(join(output,`${name}-selection.png`),(await window.webContents.capturePage()).toPNG());
  await js(`(()=>{const label=[...document.querySelectorAll('.capital-contest-selection dt')].find(e=>e.textContent==='Money-weighted annual IRR (ACT/365)');label.parentElement.scrollIntoView({block:'center',behavior:'instant'});})()`);await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  check(`${name}: annual IRR labeled and number kept intact`,await js(`(()=>{const label=[...document.querySelectorAll('.capital-contest-selection dt')].find(e=>e.textContent==='Money-weighted annual IRR (ACT/365)'),number=label?.parentElement.querySelector('.capital-contest-metric-value');return number?.textContent==='24.4749…%'&&number.title.includes('24.474952665655')&&number.getClientRects().length===1;})()`));if(!process.argv.includes('--checks-only'))writeFileSync(join(output,`${name}-rates.png`),(await window.webContents.capturePage()).toPNG());
  check(`${name}: no run or financial action`,await js(`![...document.querySelectorAll('.capital-contest button')].some(b=>/^(run|enable|adopt|withdraw|reserve)$/i.test(b.innerText.trim()))`));
 }
 check('period, exposure and trial assumptions explicit',await js(`document.querySelector('.capital-contest').innerText.includes('USD simulation')&&document.querySelector('.capital-contest').innerText.includes('known-lower-bound')`));
 const snapshot=()=>JSON.stringify(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,database.prepare(`SELECT * FROM ${name}`).all()]));
 const before=snapshot(),catalog=await js(`window.coqui.query('research.capital-contest.runs',{limit:100})`),detail=await js(`window.coqui.query('research.capital-contest.detail',${JSON.stringify({runId,cellId:null,page:0,limit:2})})`);
 check('production preload reads bounded results',catalog.status==='ok'&&catalog.value.runs.length===2&&detail.status==='ok'&&detail.value.cells.length===2&&detail.value.hasMore);
 const failedResult=await dispatch('research.capital-contest.detail',{runId:failedHash,cellId:null,page:0,limit:1});check('interruption differs from zero return',failedResult.status==='ok'&&failedResult.value.run.status==='interrupted'&&failedResult.value.cells.length===0);
 check('read routes leave all database rows unchanged',before===snapshot());check('no run or financial controls',await js(`![...document.querySelectorAll('.capital-contest button')].some(b=>/^(Run|Adopt|Enable|Withdraw|Execute|Commit)/i.test(b.innerText))`));
 const gate=await dispatch('risk.evidence-gate',{});check('live authority remains disabled',gate.status==='ok'&&gate.value.liveExecutionPermitted===false);check('no renderer errors',rendererErrors.length===0,rendererErrors.join('; '));
 writeFileSync(join(output,'smoke.json'),JSON.stringify({synthetic:true,accountAccess:false,runId,checks,rendererErrors,browserNotices},null,2)+'\n');
}
app.whenReady().then(run).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{window?.destroy();database?.close();runtime?.dispose();rmSync(directory,{recursive:true,force:true});app.exit(process.exitCode??0);});
