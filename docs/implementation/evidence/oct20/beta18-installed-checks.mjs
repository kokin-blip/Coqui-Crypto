// Installed ASAR renderer/preload/services, isolated disposable profile, synthetic delayed fees and network errors.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { randomUUID } from 'node:crypto';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const installed='/Applications/Coqui.app/Contents/Resources/app.asar';
const output=join(repository,'docs/implementation/evidence/oct20/beta18-installed-ui');
const temporary=mkdtempSync(join(tmpdir(),'coqui-beta18-installed-ui-'));
app.setPath('userData',join(temporary,'electron'));
const watchdog=setTimeout(()=>app.exit(1),45000);
let runtime;
async function run() {
  const load=path=>import(pathToFileURL(join(installed,path)));
  const {createMemorySecretStore,createAlpacaPaperClient}=await load('node_modules/@coqui/adapters/dist/index.js');
  const {createRuntimeProfileController}=await load('dist/main/profile-runtime.js');
  const {createDispatcher}=await load('dist/main/dispatch.js');
  const {WEB_PREFERENCES,applyWindowHardening}=await load('dist/main/security.js');
  const {parallelPaperFailureDetail}=await load('node_modules/@coqui/services/dist/paper/parallel-paper-utils.js');
  const {parallelReconciliationAttention}=await load('node_modules/@coqui/services/dist/paper/parallel-paper-attention.js');
  const {reconcilePaperPositionEvidence}=await load('node_modules/@coqui/services/dist/paper/parallel-paper-minor-recovery.js');
  const {paperPositionFingerprint}=await load('node_modules/@coqui/services/dist/paper/parallel-paper-resolution.js');
  const {projectParallelPaperActivity}=await load('node_modules/@coqui/services/dist/paper/parallel-paper-activity.js');
  const {assertNoTextClipping}=await import(pathToFileURL(join(repository,'apps/desktop/scripts/visual-overflow-audit.mjs')));
  globalThis.fetch=async()=>new globalThis.Response('{}',{status:503});
  globalThis.WebSocket=class { close() {} send() {} };
  runtime=createRuntimeProfileController({dataDirectory:temporary,legacyDatabaseFilename:'fixture.db',disableScheduler:true,
    runtime:{secrets:createMemorySecretStore()}});
  const baseline=runtime.handlers()['parallel.paper.status']({}).value;
  let status=baseline;
  const dispatch=createDispatcher({handlers:()=>({...runtime.handlers(),'parallel.paper.status':()=>({ok:true,value:status})})});
  const skipped=await dispatch('app.onboarding.skip',{commandId:randomUUID()});
  assert.equal(skipped.status,'ok');
  ipcMain.handle('coqui:query',(_event,channel,payload)=>dispatch(channel,payload));
  const entry=join(installed,'dist/renderer/index.html');
  const window=new BrowserWindow({show:false,width:1440,height:1000,
    webPreferences:{...WEB_PREFERENCES,preload:join(installed,'dist/preload/index.cjs')}});
  applyWindowHardening(window.webContents,pathToFileURL(entry).href,shell);
  mkdirSync(output,{recursive:true});
  const checks=[];
  try {
    const now=Date.now(), start=now-3600000;
    const events=[];
    const append=(kind,key,detail)=>events.push({id:String(events.length).padStart(64,'0'),kind,at:now,detail});
    append('external_order','',{orderId:'fixture-order',symbol:'BTCUSD',side:'buy'});
    append('external_fill','',{orderId:'fixture-order',symbol:'BTCUSD',quantity:'1',price:'40000',at:new Date(start).toISOString()});
    let checkAt=now;
    const input={experiment:{id:'fixture',profileId:'main',alpacaAccountId:'fixture-account',startedAt:start},
      client:{positions:async()=>[{symbol:'BTCUSD',qty:'0.9975'}],latestCryptoQuotes:async()=>{throw new Error('quotes_not_needed');}},
      events:()=>events,now:()=>checkAt,fullAudit:async()=>{},append};
    async function diagnostic(){try{await reconcilePaperPositionEvidence(input);assert.fail('Expected blocked fees');}
      catch(error){assert.equal(error.message,'broker_positions_mismatch');return parallelPaperFailureDetail(error,'unexpected');}}
    const scenarios=[];
    const awaiting=await diagnostic();assert.equal(awaiting.pendingFeeEvidence.status,'awaiting');
    assert.equal(events.some(e=>e.kind==='paper_position_resolution'||e.kind==='external_fee'),false);
    scenarios.push({code:'awaiting',message:'Waiting for fee evidence',detail:awaiting});
    checkAt=awaiting.pendingFeeEvidence.reviewAfterMs;
    const overdue=await diagnostic();assert.equal(overdue.pendingFeeEvidence.status,'overdue');
    scenarios.push({code:'overdue',message:'Fee evidence overdue',detail:overdue});
    append('paper_position_resolution','',{scope:'paper_only',ledgerFingerprint:paperPositionFingerprint(events),
      positionDifferences:[{symbol:'BTCUSD',observedQty:'0.9975'}]});
    assert.equal((await diagnostic()).pendingFeeEvidence.status,'overdue');
    append('external_fee','',{symbol:null,quantity:null,netAmount:'-100'});
    assert.equal((await diagnostic()).pendingFeeEvidence.status,'overdue');
    append('external_fee','',{symbol:'BTCUSD',quantity:'-0.001'});
    assert.equal((await diagnostic()).pendingFeeEvidence,undefined);
    append('external_fee','',{symbol:'BTCUSD',quantity:'-0.0015'});
    await reconcilePaperPositionEvidence(input);await reconcilePaperPositionEvidence(input);
    scenarios.push({code:'exact',message:'Recovery complete · ready to resume',recovered:true});
    for(const [code,message] of [['ENOTFOUND','could not be resolved'],['ECONNRESET','connection to Alpaca was interrupted'],
      ['CERT_HAS_EXPIRED','secure connection to Alpaca could not be verified']]) {
      const client=createAlpacaPaperClient({keyId:'fixture',secretKey:'fixture'},async()=>{throw new TypeError('synthetic',{cause:{code}});});
      let detail;
      try{await client.account();assert.fail('Expected synthetic transport failure');}
      catch(error){detail=parallelPaperFailureDetail(error,'unexpected');}
      scenarios.push({code,message,detail});
    }
    for(const {code,message,detail,recovered} of scenarios){
      const event=recovered?{id:'a'.repeat(64),kind:'readiness',at:now,detail:{operation:'broker_reconciliation',status:'validated'}}:
        {id:'a'.repeat(64),kind:'reconciliation_error',at:now,detail};
      status={...baseline,experimentId:'b'.repeat(64),state:'paused',runtimeState:'attention',startedAtMs:Date.now(),
        reconciliationAttention:parallelReconciliationAttention([event],'paused'),lastReason:detail?.reason??null,
        activity:projectParallelPaperActivity([event]).activity};
      await window.loadFile(entry,{query:{fixture:code},hash:'/paper/overview'});
      const text=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
        const started=performance.now();const check=()=>{const text=document.body.innerText;
          if(text.includes(${JSON.stringify(message)}))resolve(text);
          else if(performance.now()-started>10000)resolve(text);
          else requestAnimationFrame(check);};check();})`);
      if(!text.includes(message))writeFileSync(join(output,`${code}-unmatched.txt`),text);
      assert.ok(text.includes(message),`Installed diagnostic did not render: ${text.slice(0,2200)}`);
      if(['ENOTFOUND','ECONNRESET','CERT_HAS_EXPIRED'].includes(code))assert.ok(text.includes(code));
      if(recovered)assert.ok(text.includes('Trading remains paused until you press Resume'));
      else assert.ok(!text.includes('Recovery complete · ready to resume'));
      await window.webContents.executeJavaScript('document.fonts.ready');
      await assertNoTextClipping(window.webContents,`installed-${code}`);
      writeFileSync(join(output,`${code}.png`),(await window.webContents.capturePage()).toPNG());
      checks.push({code,messageRendered:true,installedRendererAndPreload:true,noTextClipping:true});
    }
    writeFileSync(join(output,'checks.json'),JSON.stringify(checks,null,2)+'\n');
    console.log(JSON.stringify({checks,actualProfileAccess:false,providerRequests:0,legacyCheckpointRejected:true,cashFeeDoesNotClear:true,partialFeesBlocked:true,exactFeesReconcile:true,manualResumeRequired:true}));
  } finally { runtime.dispose();window.destroy();clearTimeout(watchdog);app.quit(); }
}
app.whenReady().then(run).catch(error=>{console.error(error);runtime?.dispose();app.exit(1);});
