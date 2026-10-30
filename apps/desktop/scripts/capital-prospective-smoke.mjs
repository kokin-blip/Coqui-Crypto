import {Buffer} from 'node:buffer';
import {app,BrowserWindow,ipcMain,shell} from 'electron';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '@coqui/storage';
import {seedCoinbaseSmokeProfile} from './coinbase-settings-smoke.mjs';
import {assertNoTextClipping} from './visual-overflow-audit.mjs';
console.log('P7 native module imports loaded');
const root=dirname(dirname(fileURLToPath(import.meta.url))),repo=dirname(dirname(root)),out=join(repo,'docs/implementation/evidence/p7-prospective-2026-10-27/ui'),folder=mkdtempSync(join(tmpdir(),'coqui-p7-native-'));
app.setPath('userData',join(folder,'browser'));app.setPath('sessionData',join(folder,'browser'));
const {createRuntimeProfileController}=await import('../dist/main/profile-runtime.js'),{createDispatcher}=await import('../dist/main/dispatch.js'),{applyWindowHardening,WEB_PREFERENCES}=await import('../dist/main/security.js');
console.log('P7 native Main imports loaded',app.isReady());
let runtime,window,db;const checks=[],errors=[];
const check=(name,passed,detail='')=>{checks.push({name,passed,detail});console.log(`${passed?'PASS':'FAIL'} ${name} ${detail}`);if(!passed)throw new Error(name);};
const js=source=>window.webContents.executeJavaScript(source),wait=async source=>{for(let i=0;i<100;i++){if(await js(`Boolean(${source})`))return;await delay(80);}throw new Error(`P7 wait: ${source}`);};
async function run(){
 mkdirSync(out,{recursive:true});globalThis.WebSocket=class{close(){}send(){}};globalThis.fetch=async()=>new globalThis.Response('{}',{status:503});await seedCoinbaseSmokeProfile(folder);
 runtime=createRuntimeProfileController({dataDirectory:folder,legacyDatabaseFilename:'coqui.db',disableScheduler:true,runtime:{hostId:'p7-native'}});db=openDatabase(join(folder,'coqui.db'));
 const dispatch=createDispatcher({handlers:()=>runtime.handlers()});await dispatch('app.onboarding.skip',{commandId:globalThis.crypto.randomUUID()});ipcMain.handle('coqui:query',(_event,channel,payload)=>dispatch(channel,payload));
 const entry=join(root,'dist/renderer/index.html');window=new BrowserWindow({show:true,width:1440,height:1000,useContentSize:true,webPreferences:{...WEB_PREFERENCES,preload:join(root,'dist/preload/index.cjs'),backgroundThrottling:false}});
 window.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('frame-ancestors'))errors.push(event.message);});applyWindowHardening(window.webContents,pathToFileURL(entry).href,shell);await window.loadFile(entry,{hash:'/research'});await wait("document.querySelector('.capital-prospective')?.innerText.includes('No prospective study')");
 check('boot has no enrollment or paper permission',db.prepare('SELECT COUNT(*) n FROM prospective_registrations_v1').get().n===0&&db.prepare('SELECT COUNT(*) n FROM prospective_bindings_v1').get().n===0);
 const fixture=JSON.parse(readFileSync(join(out,'synthetic-fixture.json'),'utf8'));db.exec('BEGIN IMMEDIATE');try{for(const item of fixture.rows){const columns=Object.keys(item.row);db.prepare(`INSERT INTO ${item.table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(k=>item.row[k]));}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 const registrationId=fixture.registrationId;await window.webContents.reload();await wait("document.querySelector('.capital-prospective select')");
 check('explicit study selection keeps outcome bodies unopened',await js("document.querySelector('.capital-prospective select').value==='' && !document.querySelector('.capital-prospective').innerText.includes('Coverage of due')"));
 const before=JSON.stringify(['prospective_registrations_v1','prospective_captures_v1','prospective_book_revisions_v1','prospective_decisions_v1','paper_orders_v3','paper_fills_v3','paper_ledger_entries_v3'].map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
 const select=async()=>{await js(`(()=>{const e=document.querySelector('.capital-prospective select');e.value=${JSON.stringify(registrationId)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait("document.querySelector('.capital-prospective')?.innerText.includes('Coverage of due')");};await select();
 check('sealed final action evidence and correction gaps survive production preload',await js("document.querySelector('.capital-prospective').innerText.includes('Sealed / unverified') && document.querySelector('.capital-prospective').innerText.includes('Collector health has not been verified')"));
 for(const [name,theme,width,height,zoom] of [['desktop-dark','dark',1440,1000,1],['narrow-light','light',640,900,1],['contrast-zoom','high_contrast',1280,1000,2]]){
  await dispatch('accounts.settings.set',{commandId:globalThis.crypto.randomUUID(),patch:{theme,density:'compact',motion:'none'}});window.setContentSize(width,height);window.webContents.setZoomFactor(zoom);const ready=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reload();await ready;await wait("document.querySelector('.capital-prospective select')");await select();await js("document.querySelector('.capital-prospective').scrollIntoView({block:'start'})");await delay(120);
  check(`${name}: labels and narrow scrolling`,await js("(()=>{const e=document.querySelector('.capital-prospective');return [...e.querySelectorAll('select')].every(s=>s.labels.length>0)&&e.scrollWidth<=e.clientWidth+2;})()"));await assertNoTextClipping(window.webContents,`p7-${name}`);
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  // Capture the actual view at native zoom; Electron's surface-copy capture rejects 200% zoom on this host.
  window.webContents.debugger.attach('1.3');try{const screenshot=await window.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false});writeFileSync(join(out,`${name}.png`),Buffer.from(screenshot.data,'base64'));}finally{window.webContents.debugger.detach();}
  await js("[...document.querySelectorAll('.capital-prospective details')].forEach(e=>e.open=['Scope, timing and provenance','Calculation and input identity'].includes(e.querySelector('summary')?.textContent))");
  await js("window.scrollTo(0,0)");
  // Layout after expanding provenance must reach the compositor before the full capture.
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const geometry=await js("(()=>{const r=document.querySelector('.capital-prospective').getBoundingClientRect();return {x:0,y:Math.max(0,r.top+scrollY),width:innerWidth,height:r.height,scale:1};})()");
  console.log('P7 full target capture requested',name,JSON.stringify(geometry));
  window.webContents.debugger.attach('1.3');try{const screenshot=await window.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:geometry.x*zoom,y:geometry.y*zoom,width:geometry.width*zoom,height:geometry.height*zoom,scale:1}});writeFileSync(join(out,`${name}-full.png`),Buffer.from(screenshot.data,'base64'));}finally{window.webContents.debugger.detach();}
  console.log('P7 full target capture',name,JSON.stringify(geometry));
  await js("[...document.querySelectorAll('.capital-prospective details')].forEach(e=>e.open=false)");
  await js("document.querySelector('.capital-prospective').scrollIntoView({block:'start'})");
 }
 await js("document.querySelector('.capital-prospective select').focus()");check('keyboard reaches the study selector',await js("document.activeElement===document.querySelector('.capital-prospective select')"));
 for(const channel of ['research.prospective.instances','research.prospective.coverage','research.prospective.development'])await dispatch(channel,channel.endsWith('instances')?{limit:50}:{registrationId});
 check('read projection has no financial or lifecycle writes',before===JSON.stringify(['prospective_registrations_v1','prospective_captures_v1','prospective_book_revisions_v1','prospective_decisions_v1','paper_orders_v3','paper_fills_v3','paper_ledger_entries_v3'].map(t=>db.prepare(`SELECT * FROM ${t}`).all())));
 check('no write UI is exposed',await js("!document.querySelector('.capital-prospective button[type=submit]')"));check('live execution remains disabled',(await dispatch('risk.evidence-gate',{})).value.liveExecutionPermitted===false);check('no renderer errors',errors.length===0,errors.join('; '));writeFileSync(join(out,'smoke.json'),JSON.stringify({synthetic:true,providersStubbed:true,schedulerDisabled:true,checks,errors},null,2)+'\n');
}
app.whenReady().then(run).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{window?.destroy();db?.close();runtime?.dispose();rmSync(folder,{recursive:true,force:true});app.exit(process.exitCode??0);});
