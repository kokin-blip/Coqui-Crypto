import { app,BrowserWindow,ipcMain } from 'electron';
import { mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createMemorySecretStore } from '@coqui/adapters';
import { createRuntimeProfileController } from '../dist/main/profile-runtime.js';
import { createDispatcher } from '../dist/main/dispatch.js';
const root=dirname(dirname(fileURLToPath(import.meta.url))),repository=dirname(dirname(root));
const data=mkdtempSync(join(tmpdir(),'coqui-cold-modal-')),output=join(repository,'docs/implementation/evidence/cold-modal');
let controller,window;
const checks=[];
const startedAtMs=Date.now();
function check(name,passed){checks.push({name,passed});if(!passed)throw new Error(name);}
async function waitFor(predicate){for(let i=0;i<100;i++){if(await window.webContents.executeJavaScript(predicate))return;await delay(30);}throw new Error('cold-modal-timeout');}
async function key(keyCode,modifiers=[]){window.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});window.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(20);}
app.setPath('userData',data);app.setPath('sessionData',data);
async function run(){
try{
  // Fail closed at the network boundary. No credentials, providers or broker exercise.
  globalThis.fetch=async()=>new globalThis.Response('{}',{status:503});
  globalThis.WebSocket=class{close(){}send(){}};
  controller=createRuntimeProfileController({dataDirectory:data,legacyDatabaseFilename:'coqui.db',disableScheduler:true,runtime:{secrets:createMemorySecretStore()}});
  const dispatch=createDispatcher({handlers:()=>controller.handlers()});let nameOutcome='blocked',skipRefused=true;
  ipcMain.handle('coqui:query',async(_event,channel,payload)=>{
    if(channel==='app.onboarding.status'||channel==='app.profile-readiness')await delay(150);
    if(channel==='app.person.set')return {status:nameOutcome,issues:[{path:[],code:nameOutcome==='blocked'?'gate_not_met':'ambiguous_outcome'}]};
    if(channel==='app.onboarding.skip'&&skipRefused){skipRefused=false;return {status:'failed',issues:[{path:[],code:'fixture_skip_refused'}]};}
    return dispatch(channel,payload);
  });
  window=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:join(root,'dist/preload/index.cjs')}});
  await window.loadFile(join(root,'dist/renderer/index.html'),{hash:'/overview'});
  await waitFor("document.querySelector('dialog.onboarding-dialog:modal')!==null");
  check('delayed cold reads mount a native modal',await window.webContents.executeJavaScript("document.querySelector('.onboarding-dialog').matches(':modal')"));
  check('name has initial focus',await window.webContents.executeJavaScript("document.activeElement.matches('.onboarding-dialog input')"));
  await window.webContents.executeJavaScript("document.querySelector('#main-content').focus()");
  check('background cannot acquire focus',await window.webContents.executeJavaScript("document.activeElement.closest('.onboarding-dialog')!==null"));
  for(const modifiers of [[],['shift']])for(let i=0;i<12;i++){await key('Tab',modifiers);check(`Tab containment ${modifiers.length?'reverse':'forward'} ${i}`,await window.webContents.executeJavaScript("document.activeElement.closest('.onboarding-dialog')!==null"));}
  mkdirSync(output,{recursive:true});writeFileSync(join(output,'cold-1280.png'),(await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`(()=>{const input=document.querySelector('.onboarding-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Fixture operator');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await delay(30);await window.webContents.executeJavaScript("document.querySelector('.onboarding-dialog form button').click()");
  await waitFor("document.body.innerText.includes('Setup save blocked')");
  check('refusal preserves the name and step',await window.webContents.executeJavaScript("document.querySelector('.onboarding-dialog input').value==='Fixture operator' && document.querySelector('#onboarding-title').textContent.includes('What should')"));
  nameOutcome='unknown';await window.webContents.executeJavaScript("document.querySelector('.onboarding-dialog form button').click()");
  await waitFor("document.body.innerText.includes('Save outcome unknown')");
  check('unknown completion disables blind save retry',await window.webContents.executeJavaScript("document.querySelector('.onboarding-dialog form button').disabled"));
  await window.webContents.setZoomFactor(2);await delay(200);
  writeFileSync(join(output,'unknown-200pct.png'),(await window.webContents.capturePage()).toPNG());
  check('zoom retains a bounded modal',await window.webContents.executeJavaScript("(()=>{const r=document.querySelector('.onboarding-dialog').getBoundingClientRect();return r.height<=innerHeight && r.width<=innerWidth;})()"));
  await key('Escape');await delay(220);
  check('failed Escape skip retains the modal',await window.webContents.executeJavaScript("document.querySelector('.onboarding-dialog:modal')!==null"));
  await key('Escape');await waitFor("document.querySelector('.onboarding-dialog')===null");
  await delay(100);
  check('successful skip returns focus to Terminal',await window.webContents.executeJavaScript("document.activeElement.id==='main-content' || document.activeElement.matches('[data-route-heading]')"));
  await window.webContents.setZoomFactor(1);
  await window.webContents.executeJavaScript("location.hash='/settings'");
  await waitFor("document.querySelector('#settings-tab-recovery')!==null");
  await window.webContents.executeJavaScript("document.querySelector('#settings-tab-recovery').click()");
  await waitFor("document.body.innerText.includes('Schema 92')");
  check('Recovery/About reads the disposable schema and keeps certification unverified',await window.webContents.executeJavaScript("document.body.innerText.includes('Restore proof: not certified for this profile')"));
  await window.webContents.executeJavaScript("location.hash='/research'");
  await waitFor("document.body.innerText.includes('Governed experiments')");
  check('research workspace exposes no transition commands',await window.webContents.executeJavaScript("document.body.innerText.includes('No transition commands are available here')"));
  const restarted=await dispatch('app.onboarding.restart',{commandId:globalThis.crypto.randomUUID()});check('explicit reopen confirmed',restarted.status==='ok');
  window.webContents.reload();await new Promise(resolve=>window.webContents.once('did-finish-load',resolve));
  await waitFor("document.querySelector('.onboarding-dialog:modal')!==null");check('reopen mounts modal again',true);
  const workload={version:1,network:'always_503',scheduler:'disabled',coldReadDelayMs:150,nameOutcomes:['blocked','unknown'],skipOutcomes:['failed','ok'],viewport:[1280,800],zoom:[1,2]};
  writeFileSync(join(output,'checks.json'),JSON.stringify({simulated:true,profileKind:'disposable',
    sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),
    buildIdentity:JSON.parse(readFileSync(join(root,'dist/main/build-info.json'),'utf8')),
    environment:{platform:process.platform,electron:process.versions.electron,node:process.versions.node},
    startedAtMs,completedAtMs:Date.now(),workload,workloadHash:createHash('sha256').update(JSON.stringify(workload)).digest('hex'),
    authority:'approved local implementation fixture',rights:'generated fixture UI only',checks,
    excluded:['VoiceOver','real account/provider/broker evidence','actual-profile migration/restore','installed distributable','real-market latency']},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,simulated:true,VoiceOver:'unverified'}));
}catch(error){console.error('Cold modal fixture failed:',error.message);process.exitCode=1;}
finally{window?.destroy();controller?.dispose();rmSync(data,{recursive:true,force:true});app.exit(process.exitCode??0);}

}
app.whenReady().then(run).catch(error=>{console.error(error.message);app.exit(1);});
