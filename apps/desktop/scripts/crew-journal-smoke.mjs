import { app,BrowserWindow,ipcMain,shell } from 'electron';
import { seedCoinbaseSmokeProfile } from './coinbase-settings-smoke.mjs';
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { sha256Hex,strategyDecisionId } from '@coqui/core';
import { appendOperationsActivity,openDatabase,saveStrategyDecision } from '@coqui/storage';

const root=dirname(dirname(fileURLToPath(import.meta.url))),repository=dirname(dirname(root));
const output=join(repository,'docs/implementation/evidence/coq32');
const directory=mkdtempSync(join(tmpdir(),'coqui-crew-journal-'));
const {createRuntimeProfileController}=await import('../dist/main/profile-runtime.js');
const {createDispatcher}=await import('../dist/main/dispatch.js');
const {applyWindowHardening,WEB_PREFERENCES}=await import('../dist/main/security.js');
const checks=[],counts=new Map(),performanceEvidence={};let runtime,db,window,holdNextGroup=false,groupHeld=false;
function check(name,pass,detail=''){checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name} ${detail}`);if(!pass)throw new Error(name);}
const js=code=>window.webContents.executeJavaScript(code);
async function waitFor(code){for(let i=0;i<80;i++){if(await js(code))return;await delay(100);}throw new Error(`Timed out: ${code}; ${await text()}; counts=${JSON.stringify(Object.fromEntries(counts))}`);}
const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const text=()=>js(`document.querySelector('[aria-labelledby="crew-journal-heading"]').innerText`);
async function heapBytes(){if(!window.webContents.debugger.isAttached())window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');return (await window.webContents.debugger.sendCommand('Runtime.getHeapUsage')).usedSize;}
let fixtureTime=Date.now()-120000;
function record(workId,worker,phase,status,facts={},atMs=fixtureTime++){
  return appendOperationsActivity({profileId:runtime.activeProfile().id,workId,attemptId:`fixture-${worker}-${phase}-${atMs}`,
    worker,source:'paper_ledger',phase,status,atMs,deadlineAtMs:null,facts},db);
}
async function run(){
  mkdirSync(output,{recursive:true});
  globalThis.WebSocket=class{close(){}send(){}};
  globalThis.fetch=async()=>new globalThis.Response('{}',{status:503});
  await seedCoinbaseSmokeProfile(directory);
  runtime=createRuntimeProfileController({dataDirectory:directory,legacyDatabaseFilename:'coqui.db',disableScheduler:true,runtime:{}});
  const profileId=runtime.activeProfile().id;
  db=openDatabase(join(directory,'coqui.db'));
  const id=strategyDecisionId(profileId,fixtureTime),workId=`decision:${id}`;
  saveStrategyDecision({schemaVersion:1,decisionId:id,profileId,runId:sha256Hex('fixture-run'),scheduledForMs:fixtureTime,
    strategy:{id:'trendvol',version:'synthetic-visual-fixture',configHash:sha256Hex('fixture-config')},
    market:{snapshotHash:sha256Hex('fixture-market'),asOfMs:fixtureTime,expectedAsOfMs:fixtureTime,freshness:'fresh',refreshResult:'succeeded',ruleSnapshotHash:sha256Hex('fixture-rules'),rulesFresh:true},
    portfolio:{snapshotHash:sha256Hex('fixture-portfolio'),version:'fixture',source:'paper_ledger'},
    targets:[{assetId:'coinbase|spot|BTC-USD',weight:0.5}],cashWeight:0.5,exposure:0.5,historyStatus:'complete',facts:null,createdAtMs:fixtureTime},db);
  for(let i=0;i<7;i++)record(`host:older-${i}`,'host','evaluation_finished','completed',{},fixtureTime-10000-i);
  record(workId,'host','evaluation_started','completed',{decisionId:id});
  record(workId,'risk','gates_finished','blocked',{decisionId:id,reasonCode:'stale_market_data'});
  record(workId,'research','worker_completed','completed',{jobId:'synthetic-linked-research'});
  record(workId,'execution','execution_refused','blocked',{decisionId:id,reasonCode:'gates_refused'});
  record(workId,'advisor','explanation_finished','completed',{decisionId:id});
  record(workId,'host','evaluation_finished','blocked',{decisionId:id,reasonCode:'gates_refused'});
  const dispatch=createDispatcher({handlers:()=>runtime.handlers()});
  await dispatch('app.onboarding.skip',{commandId:globalThis.crypto.randomUUID()});
  ipcMain.handle('coqui:query',async(_event,channel,payload)=>{counts.set(channel,(counts.get(channel)??0)+1);const result=await dispatch(channel,payload);
    if(channel==='operations.journal.group'&&holdNextGroup){holdNextGroup=false;groupHeld=true;await delay(1500);}return result;});
  window=new BrowserWindow({show:true,width:1440,height:1000,useContentSize:true,
    webPreferences:{...WEB_PREFERENCES,preload:join(root,'dist/preload/index.cjs'),backgroundThrottling:false}});
  const entry=join(root,'dist/renderer/index.html');applyWindowHardening(window.webContents,pathToFileURL(entry).href,shell);
  await window.loadFile(entry,{hash:'/activity'});window.focus();
  await waitFor(`document.querySelectorAll('.crew-journal-entry').length>5`);
  const interactions=await js(`(async()=>{const samples=[];for(let i=0;i<30;i++){const start=performance.now();await window.coqui.query('operations.journal',{worker:null,limit:5,cursor:null});await new Promise(resolve=>requestAnimationFrame(resolve));samples.push(performance.now()-start);}return samples.sort((a,b)=>a-b)})()`);
  performanceEvidence.journalPaintP75Ms=interactions[Math.ceil(interactions.length*.75)-1];
  check('journal IPC to painted frame stays within200ms p75',performanceEvidence.journalPaintP75Ms<=200,String(performanceEvidence.journalPaintP75Ms));
  check('journal is between the six bots and decision feed',await js(`(()=>{const panel=document.querySelector('[aria-labelledby="crew-journal-heading"]');return panel.previousElementSibling.classList.contains('operations-floor')&&panel.nextElementSibling.querySelector('#activity-feed-heading')!==null})()`));
  check('all six workers have readable messages',await js(`['Coqui','Scout','Guard','Darwin','Courier','Advisor'].every(name=>Array.from(document.querySelectorAll('.crew-journal-byline strong')).some(el=>el.textContent===name))`));
  check('latest group is expanded and older groups are compact',await js(`document.querySelectorAll('.crew-journal-group-trigger[aria-expanded="true"]').length===1&&document.querySelectorAll('.crew-journal-group').length===5`));
  await click('.crew-journal-evidence summary');
  check('technical evidence expands without starting an Advisor request',await js(`document.querySelector('.crew-journal-evidence').open`)&&!counts.has('advisor.decision.explain'));
  await js(`document.querySelector('.crew-journal-evidence summary').focus()`);
  record(workId,'market','dataset_checked','completed',{decisionId:id,instruments:'ETH-USD',freshness:'fresh'});
  await waitFor(`document.querySelector('.crew-journal-announcement').innerText.includes('New activity available')`);
  check('polling retains open evidence and keyboard focus',await js(`document.querySelector('.crew-journal-evidence').open&&document.activeElement===document.querySelector('.crew-journal-evidence summary')`));
  await js(`document.querySelector('.crew-journal-scroll').scrollTop=150;document.querySelector('.crew-journal-announcement button').click()`);
  check('jump to latest restores the top and a stable keyboard destination',await js(`document.querySelector('.crew-journal-scroll').scrollTop===0&&document.activeElement===document.querySelector('.crew-journal-scroll')`));
  await waitFor(`document.querySelector('[aria-labelledby="crew-journal-heading"]').innerText.includes('ETH-USD')`);
  await js(`Array.from(document.querySelectorAll('.crew-journal-toolbar button')).find(b=>b.textContent.includes('Pause updates')).click()`);
  const paused=await text();record(workId,'execution','execution_refused','blocked',{reasonCode:'kill_switch_engaged'});
  await delay(2400);
  const after=await text();check('pause freezes displayed messages while collecting updates',!after.includes('safety stop is engaged')&&after.includes('Display paused')&&paused.includes('Display paused'));
  await js(`Array.from(document.querySelectorAll('.crew-journal-toolbar button')).find(b=>b.textContent.includes('Resume updates')).click()`);
  await waitFor(`document.querySelector('[aria-labelledby="crew-journal-heading"]').innerText.includes('safety stop is engaged')`);
  check('resume catches up with actual recorded evidence',true);
  window.blur();await delay(400);const backgroundCount=counts.get('operations.journal')??0;await delay(2400);
  check('backgrounding the window stops journal polling',(counts.get('operations.journal')??0)===backgroundCount);window.focus();await delay(300);
  await click('.crew-journal-controls button');await delay(400);const count=counts.get('operations.journal')??0;await delay(2400);
  check('collapse stops journal polling',(counts.get('operations.journal')??0)===count);
  await click('.crew-journal-controls button');await waitFor(`document.querySelectorAll('.crew-journal-entry').length>0`);
  await js(`(()=>{const select=document.querySelector('#crew-journal-worker');select.value='research';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`document.querySelectorAll('.crew-journal-byline strong').length===1&&document.querySelector('.crew-journal-byline strong').textContent==='Darwin'`);
  check('crew filter applies to grouped entries',true);
  await js(`(()=>{const select=document.querySelector('#crew-journal-worker');select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`document.querySelectorAll('.crew-journal-entry').length>5`);
  const measurements=[];
  for(const [name,theme,width,zoom] of [['dark','dark',1440,1],['light','light',1280,1],['contrast','high_contrast',1280,1],['zoom','high_contrast',1280,2]]){
    const appearance=await dispatch('accounts.settings.set',{commandId:globalThis.crypto.randomUUID(),patch:{theme,density:'compact',motion:'none'}});
    check(`${name} appearance command succeeds`,appearance.status==='ok');
    const reloaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reload();await reloaded;await waitFor(`document.querySelectorAll('.crew-journal-entry').length>5`);
    window.setContentSize(width,1000);window.webContents.setZoomFactor(zoom);
    await waitFor(`document.documentElement.dataset.theme===${JSON.stringify(theme.replace('_','-'))}`);
    await js(`document.querySelector('[aria-labelledby="crew-journal-heading"]').scrollIntoView({block:'start'})`);await delay(200);
    const geometry=await js(`(()=>{const panel=document.querySelector('[aria-labelledby="crew-journal-heading"]');return {width:panel.clientWidth,scrollWidth:panel.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth,figma:Array.from(panel.querySelectorAll('[data-figma-node]')).map(el=>el.dataset.figmaNode)}})()`);
    check(`${name} journal fits without horizontal clipping`,!geometry.overflow&&geometry.scrollWidth<=geometry.width+1);
    check(`${name} reuses Figma component mappings`,['3:66','3:37','3:56','3:46'].every(id=>geometry.figma.includes(id)));
    writeFileSync(join(output,`crew-journal-${name}.png`),(await window.webContents.capturePage()).toPNG());measurements.push({name,...geometry});
  }
  window.webContents.setZoomFactor(1);window.setContentSize(1440,1500);
  await js(`document.querySelector('.operations-floor').scrollIntoView({block:'start'})`);await delay(200);
  writeFileSync(join(output,'crew-journal-placement.png'),(await window.webContents.capturePage()).toPNG());
  performanceEvidence.heapBaselineBytes=await heapBytes();
  for(let i=0;i<240;i++)record(workId,'execution','recovery','completed',{sequence:i});
  await waitFor(`document.querySelectorAll('.crew-journal-entry').length===50`);
  for(const size of [100,150,200]){await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Load older entries').click()`);await waitFor(`document.querySelectorAll('.crew-journal-entry').length===${size}`);}
  check('entry history stays bounded at200 with older history disclosed',await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Load older entries').disabled&&document.querySelector('.crew-journal-note').innerText.includes('bounded history')`));
  await js(`Array.from(document.querySelectorAll('.crew-journal-toolbar button')).find(b=>b.textContent.includes('Pause updates')).click()`);
  await waitFor(`Array.from(document.querySelectorAll('.crew-journal-toolbar button')).some(b=>b.textContent.includes('Resume updates'))`);
  await js(`Array.from(document.querySelectorAll('.crew-journal-toolbar button')).find(b=>b.textContent.includes('Resume updates')).click()`);
  await waitFor(`document.querySelectorAll('.crew-journal-entry').length===50`);
  performanceEvidence.heapSamplesBytes=[];
  for(let round=0;round<4;round++){for(let i=0;i<60;i++)record(workId,'execution','recovery','completed',{sequence:round*60+i});await delay(2200);performanceEvidence.heapSamplesBytes.push(await heapBytes());}
  check('sustained updates keep rendered entries and retained heap bounded',await js(`document.querySelectorAll('.crew-journal-entry').length===50`)&&Math.max(...performanceEvidence.heapSamplesBytes)-performanceEvidence.heapBaselineBytes<32*1024*1024);
  holdNextGroup=true;for(let i=0;i<60&&!groupHeld;i++)await delay(100);check('profile switch fixture has a delayed prior-profile read',groupHeld);
  await js(`(()=>{const select=document.querySelector('select[aria-label="Active profile"]');select.value='00000000-0000-4000-8000-000000000001';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`document.querySelector('[aria-labelledby="crew-journal-heading"]')?.innerText.includes('Waiting for the next recorded update')`);
  await delay(1800);check('profile switch rejects late prior-profile journal evidence',!(await text()).includes('BTC-USD')&&await js(`document.querySelectorAll('.crew-journal-entry').length===0`));
  await js(`location.hash='/overview'`);await waitFor(`document.querySelector('#crew-journal-heading')===null`);
  await delay(400);const detachedCount=counts.get('operations.journal')??0;await delay(2400);
  check('navigation away removes journal polling',(counts.get('operations.journal')??0)===detachedCount);
  check('opening the journal created no evaluations or fills',db.prepare('SELECT COUNT(*) AS count FROM wallet_decision_runs').get().count===0&&db.prepare('SELECT COUNT(*) AS count FROM paper_fills_v3').get().count===0);
  writeFileSync(join(output,'electron-checks.json'),JSON.stringify({fixtureOnly:true,checks,measurements,performance:performanceEvidence,requests:Object.fromEntries(counts)},null,2));
}
app.whenReady().then(run).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
app.on('will-quit',()=>{db?.close();runtime?.dispose();rmSync(directory,{recursive:true,force:true});});
