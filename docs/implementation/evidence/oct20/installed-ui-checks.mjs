// Installed ASAR renderer/preload/services, isolated disposable profile, synthetic network errors.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { randomUUID } from 'node:crypto';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const installed=process.argv[2]??'/Applications/Coqui.app/Contents/Resources/app.asar';
const output=join(repository,'docs/implementation/evidence/oct20/installed-ui');
const temporary=mkdtempSync(join(tmpdir(),'coqui-beta17-installed-ui-'));
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
    for(const [code,message] of [['ENOTFOUND','could not be resolved'],['ECONNRESET','connection to Alpaca was interrupted'],
      ['CERT_HAS_EXPIRED','secure connection to Alpaca could not be verified']]) {
      const client=createAlpacaPaperClient({keyId:'fixture',secretKey:'fixture'},async()=>{throw new TypeError('synthetic',{cause:{code}});});
      let detail;
      try{await client.account();assert.fail('Expected synthetic transport failure');}
      catch(error){detail=parallelPaperFailureDetail(error,'unexpected');}
      const event={id:'a'.repeat(64),kind:'reconciliation_error',at:Date.now(),detail};
      status={...baseline,experimentId:'b'.repeat(64),state:'paused',runtimeState:'attention',startedAtMs:Date.now(),
        reconciliationAttention:parallelReconciliationAttention([event],'paused'),lastReason:detail.reason,
        activity:projectParallelPaperActivity([event]).activity};
      await window.loadFile(entry,{query:{fixture:code},hash:'/paper/overview'});
      const text=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
        const started=performance.now();const check=()=>{const text=document.body.innerText;
          if(text.includes(${JSON.stringify(message)}))resolve(text);
          else if(performance.now()-started>10000)resolve(text);
          else requestAnimationFrame(check);};check();})`);
      if(!text.includes(message))writeFileSync(join(output,`${code}-unmatched.txt`),text);
      assert.ok(text.includes(code),`Installed diagnostic did not render: ${text.slice(0,2200)}`);assert.ok(text.includes(message));
      await window.webContents.executeJavaScript('document.fonts.ready');
      await assertNoTextClipping(window.webContents,`installed-${code}`);
      writeFileSync(join(output,`${code}.png`),(await window.webContents.capturePage()).toPNG());
      checks.push({code,messageRendered:true,installedRendererAndPreload:true,noTextClipping:true});
    }
    writeFileSync(join(output,'checks.json'),JSON.stringify(checks,null,2)+'\n');
    console.log(JSON.stringify({checks,actualProfileAccess:false,providerRequests:0}));
  } finally { runtime.dispose();window.destroy();clearTimeout(watchdog);app.quit(); }
}
app.whenReady().then(run).catch(error=>{console.error(error);runtime?.dispose();app.exit(1);});
