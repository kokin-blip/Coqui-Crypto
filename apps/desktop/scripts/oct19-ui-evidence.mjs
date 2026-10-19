import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers';
import { sha256Hex, strategyDecisionId } from '@coqui/core';
import { openDatabase, saveStrategyDecision, appendDecisionEvidenceEvent } from '@coqui/storage';
import { createRuntimeProfileController } from '../dist/main/profile-runtime.js';
import { createDispatcher } from '../dist/main/dispatch.js';
import { WEB_PREFERENCES } from '../dist/main/security.js';
const desktop=dirname(dirname(fileURLToPath(import.meta.url))),root=mkdtempSync(join(tmpdir(),'coqui-oct19-ui-'));
const output=join(desktop,'../../docs/implementation/evidence/oct19/ui');mkdirSync(output,{recursive:true});
app.setPath('userData',root);app.setPath('sessionData',root);
globalThis.fetch=async()=>new globalThis.Response('{}',{status:503});globalThis.WebSocket=class{close(){}send(){}};
const checks=[];const check=(name,passed,detail=null)=>{checks.push({name,passed,detail});if(!passed)throw new Error(name);};
app.whenReady().then(async()=>{
 const runtime=createRuntimeProfileController({dataDirectory:root,legacyDatabaseFilename:'coqui.db',disableScheduler:true,runtime:{}});
 const dispatch=createDispatcher({handlers:()=>runtime.handlers()});await dispatch('app.onboarding.skip',{commandId:randomUUID()});
 const db=openDatabase(join(root,'coqui.db')),at=Date.now(),decisionId=strategyDecisionId('main',at);
 const stored=saveStrategyDecision({schemaVersion:1,decisionId,profileId:'main',runId:sha256Hex('ui-focus'),scheduledForMs:at,
 strategy:{id:'trendvol',version:'trendvol-paper-v1-unvalidated',configHash:sha256Hex('config')},
 market:{snapshotHash:sha256Hex('market'),asOfMs:at,expectedAsOfMs:at,freshness:'fresh',refreshResult:'succeeded',ruleSnapshotHash:sha256Hex('rules'),rulesFresh:true},
 portfolio:{snapshotHash:sha256Hex('portfolio'),version:'paper-v1',source:'paper_ledger'},targets:[],cashWeight:1,exposure:0,historyStatus:'complete',facts:null,createdAtMs:at},db);
 appendDecisionEvidenceEvent({schemaVersion:1,decisionId,profileId:'main',sequence:0,kind:'strategy_evaluated',atMs:at,detail:{decisionHash:stored.contentHash}},db);db.close();
 let scenario='blocked';
 ipcMain.handle('coqui:query',async(_event,channel,payload)=>{
   if(channel==='decision.detail')await new Promise(resolve=>setTimeout(resolve,75));
   if(channel==='activity.feed')await new Promise(resolve=>setTimeout(resolve,125));
   if(scenario==='loading'&&channel==='app.profile-readiness')await new Promise(resolve=>setTimeout(resolve,5000));
   if(scenario==='error'&&channel==='app.profile-readiness')return {status:'failed',issues:[{path:[],code:'fixture_unavailable'}]};
   if(scenario==='partial'&&channel==='parallel.paper.status')return {status:'unknown',issues:[{path:[],code:'fixture_unavailable'}]};
   const result=await dispatch(channel,payload);
   if(result.status==='ok'&&channel==='app.profile-readiness')return {...result,value:{...result.value,steps:result.value.steps.map(s=>({...s,status:'complete'})),stage:'ready'}};
   if(result.status==='ok'&&channel==='app.status-rail')return {...result,value:{...result.value,killSwitchEngaged:false}};
   if(result.status==='ok'&&channel==='parallel.paper.status')return {...result,value:{...result.value,reconciliationAttention:{...result.value.reconciliationAttention,blocked:true}}};
   return result;
 });
 const window=new BrowserWindow({show:true,width:1280,height:800,webPreferences:{...WEB_PREFERENCES,backgroundThrottling:false,preload:join(desktop,'dist/preload/index.cjs')}});
 const evaluate=code=>window.webContents.executeJavaScript(code);
 const wait=async predicate=>{const end=Date.now()+15000;while(Date.now()<end){if(await evaluate(predicate))return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('UI wait: '+predicate);};
 const capture=async name=>writeFileSync(join(output,`${name}.png`),(await window.webContents.capturePage()).toPNG());
 try{
  await window.loadFile(join(desktop,'dist/renderer/index.html'),{hash:'/overview'});
  await wait("document.querySelector('#readiness-title')?.textContent==='Paper orders need reconciliation'");check('operational blocker drives primary action after setup',true);
  check('paper uncertainty visible without expanding setup',await evaluate("document.querySelector('.readiness-guide > p')!==null&&[...document.querySelectorAll('.readiness-guide > p')].some(p=>p.textContent.includes('reconciliation blocks'))"));
  for(const zoom of [1,2]){window.webContents.setZoomFactor(zoom);await new Promise(resolve=>setTimeout(resolve,150));
    check(`readiness action fits 1280 window at zoom ${zoom}`,await evaluate("(()=>{const r=document.querySelector('.readiness-action').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.width>0})()"));await capture(`readiness-${zoom}`);}
  window.webContents.setZoomFactor(1);
  await evaluate("document.querySelector('.readiness-action').focus()");window.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  check('keyboard can leave primary action without a trap',await evaluate("document.activeElement!==document.querySelector('.readiness-action')"));
  await evaluate(`window.__delayedRouteFrames=[];const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>callback.toString().includes('data-route-heading')?(window.__delayedRouteFrames.push(callback),2147483000):raf(callback);location.hash='/activity';`);
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Inspect evidence')");
  await evaluate("window.__opener=[...document.querySelectorAll('button')].find(b=>b.textContent==='Inspect evidence');window.__opener.click()");
  await wait("document.activeElement===document.querySelector('#decision-detail-heading')");
  check('route focus race was exercised',await evaluate('window.__delayedRouteFrames.length>0'));
  await evaluate('window.__delayedRouteFrames.forEach(callback=>callback(performance.now()));window.__delayedRouteFrames=[]');
  const retained=await evaluate("document.activeElement===document.querySelector('#decision-detail-heading')");
  check(process.env.COQUI_EXPECT_FOCUS_FAILURE==='1'?'baseline delayed route frame steals Activity focus':'delayed route frame preserves Activity detail focus',process.env.COQUI_EXPECT_FOCUS_FAILURE==='1'?!retained:retained,{retained});
  await evaluate("document.querySelector('#decision-detail .button-secondary').click()");await wait('document.activeElement===window.__opener');check('detail close returns keyboard focus',true);
  if(process.env.COQUI_EXPECT_FOCUS_FAILURE==='1')return;
  await evaluate("location.hash='/settings'");await wait("document.querySelector('#settings-tab-recovery')");await evaluate("document.querySelector('#settings-tab-recovery').click()");await wait("document.querySelector('#recovery-report-hash')");
  await evaluate("document.querySelector('#recovery-report-hash').scrollIntoView({block:'center'})");await capture('recovery');
  check('recovery refuses missing hashes',await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Choose copied report').disabled"));
  check('learning walkthrough is visibly simulated',await evaluate("document.body.textContent.includes('Disposable learning walkthrough · simulated only')"));
  for(const name of ['loading','error','partial']){scenario=name;await window.loadFile(join(desktop,'dist/renderer/index.html'),{hash:'/overview'});
    const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reloadIgnoringCache();await loaded;
    if(name==='loading'){await wait("document.body.textContent.includes('Checking setup readiness')");await capture(name);}
    else if(name==='error'){await wait("document.body.textContent.includes('Readiness unavailable')");await capture(name);}
    else{await wait("document.querySelector('#readiness-title')?.textContent==='Operational evidence is not verified'");await capture(name);}
    check(`${name} state is explicit`,true);
  }
 }finally{
  writeFileSync(join(output,process.env.COQUI_EXPECT_FOCUS_FAILURE==='1'?'baseline-focus.json':'checks.json'),JSON.stringify({simulated:true,actualProfileOpened:false,voiceOverCertified:false,build:JSON.parse(readFileSync(join(desktop,'dist/main/build-info.json'),'utf8')),checks},null,2)+'\n');
  window.destroy();runtime.dispose();rmSync(root,{recursive:true,force:true});
 }
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
