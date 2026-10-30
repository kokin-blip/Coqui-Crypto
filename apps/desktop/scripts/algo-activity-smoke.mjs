import { app,BrowserWindow,ipcMain,shell } from 'electron';
import { Buffer } from 'node:buffer';
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { profileConnectionV2,sha256Hex } from '@coqui/core';
import {createMemorySecretStore} from '@coqui/adapters';
import { openDatabase,saveProfileConnectionV2,saveParallelExperiment,appendParallelEvent,savePaperDailyValuationEvidence } from '@coqui/storage';
import { seedCoinbaseSmokeProfile } from './coinbase-settings-smoke.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url))),repository=dirname(dirname(root));
const output=join(repository,'docs/implementation/evidence/coq33');
const directory=mkdtempSync(join(tmpdir(),'coqui-algo-activity-'));
app.setPath('userData',join(directory,'browser'));app.setPath('sessionData',join(directory,'browser'));
const {createRuntimeProfileController}=await import('../dist/main/profile-runtime.js');
const {createDispatcher}=await import('../dist/main/dispatch.js');
const {createTradingActivityHandlers}=await import('../dist/main/trading-activity-handlers.js');
const {CoinbaseMicrostructure}=await import('../dist/main/coinbase-microstructure.js');
const {applyWindowHardening,WEB_PREFERENCES}=await import('../dist/main/security.js');
const knownConsoleWarnings=[];const checks=[],counts=new Map(),readMs=[],renderErrors=[];let runtime,db,window,dispatch,activityDispatch,hold=null,failRead=false;
const now=Date.now(),day=86400000;
function check(name,passed,detail=''){checks.push({name,passed,detail});console.log(`${passed?'PASS':'FAIL'} ${name} ${detail}`);if(!passed)throw new Error(name);}
const js=code=>window.webContents.executeJavaScript(code);
const text=()=>js(`document.querySelector('.terminal-microstructure')?.innerText`);
async function waitFor(code){for(let i=0;i<100;i++){if(await js(code))return;if(!await js('document.hasFocus()')){app.focus({steal:true});window.focus();window.webContents.focus();}await delay(100);}throw new Error(`Timed out: ${code}; focus=${await js("document.hasFocus()")}; counts=${JSON.stringify(Object.fromEntries(counts))}; ${await text()}`);}
const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const select=(selector,value)=>js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
function seed(id,side,quantity,price,at,product='BTC-USD',order=id){
  const profile=runtime.activeProfile().id;
  if(!db.prepare('SELECT id FROM paper_orders_v3 WHERE id=?').get(order))db.prepare('INSERT INTO paper_orders_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(order,profile,order,product,`coinbase|spot|${product}`,side,quantity,price,'filled','fixture-rules','fixture-snapshot',null,at,at);
  db.prepare('INSERT INTO paper_fills_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,order,profile,quantity,price,price,'1','0','0','0',at,'fixture-market');
}
async function capture(name){await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');window.webContents.debugger.attach('1.3');try{const screenshot=await window.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false});writeFileSync(join(output,`${name}.png`),Buffer.from(screenshot.data,'base64'));}finally{window.webContents.debugger.detach();}}
async function run(){
  mkdirSync(output,{recursive:true});globalThis.WebSocket=class{close(){}send(){}};globalThis.fetch=async()=>new globalThis.Response('{}',{status:503});
  await seedCoinbaseSmokeProfile(directory);
  runtime=createRuntimeProfileController({dataDirectory:directory,legacyDatabaseFilename:'coqui.db',disableScheduler:true,runtime:{}});
  db=openDatabase(join(directory,'coqui.db'));const profile=runtime.activeProfile().id;
  dispatch=createDispatcher({handlers:()=>runtime.handlers()});
  await dispatch('app.onboarding.skip',{commandId:globalThis.crypto.randomUUID()});
  seed('opening-buy','buy','40','100',now-10*day);
  for(let i=0;i<23;i++)seed(`exit-${i}`,'sell','1',i%3?'120':'90',now-day+i*1000);
  seed('partial-a','sell','0.5','130',now-300000,'BTC-USD','partial-order');
  seed('partial-b','sell','0.5','125',now-200000,'BTC-USD','partial-order');
  seed('eth-buy','buy','2','100',now-100000,'ETH-USD');
  // Fixture marks are persisted test evidence, never a market-data reconstruction.
  for(const [at,quantity,value] of [[now-6*day,'40','4400'],[now-2*day,'40','4600'],[now-50000,'16','2080']]){
    const positions=[{instrument:{venue:'coinbase',productType:'spot',productId:'BTC-USD'},quantity,valueUsd:value}];
    if(at>now-100000)positions.push({instrument:{venue:'coinbase',productType:'spot',productId:'ETH-USD'},quantity:'2',valueUsd:'260'});
    savePaperDailyValuationEvidence({id:sha256Hex(String(at)),profileId:profile,dayUtc:Math.floor(at/day)*day,capturedAt:at,cashUsd:'1000',equityUsd:'10000',benchmarkUsd:null,unpricedCount:0,positionsJson:JSON.stringify(positions),provenanceJson:'{"synthetic":true}',evidenceHash:sha256Hex(`evidence:${at}`)},db);
  }
  const connection=profileConnectionV2(profile,'coinbase',sha256Hex('fixture-connection'),now-12*day);saveProfileConnectionV2(connection,db);
  const snapshot=sha256Hex('fixture-snapshot');db.prepare('INSERT INTO connection_account_snapshots_v2 VALUES (?,?,?,?,?,?,?,?,?,?)').run(snapshot,profile,connection.id,'coinbase',now,1,'healthy','{}',sha256Hex('fixture-content'),now);
  const experiment=sha256Hex('fixture-experiment');saveParallelExperiment({id:experiment,profileId:profile,sourceConnectionSnapshotId:snapshot,alpacaAccountId:'fixture-broker-123456',openingCoquiCash:'1000',openingAlpacaCash:'1000',openingAlpacaEquity:'1000',anchor:{},startedAt:now-12*day,configVersion:'fixture'},db);
  appendParallelEvent({profileId:profile,experimentId:experiment,kind:'external_fill',key:'external-fill',at:now-1000,detail:{activityId:'fixture-external',orderId:'fixture-external-order',symbol:'BTCUSD',side:'buy',quantity:'1',price:'100',at:new Date(now-1000).toISOString()}},db);
  const performanceSecrets=createMemorySecretStore();
  await performanceSecrets.write('alpaca-paper-credentials',JSON.stringify({keyId:'fixture',secretKey:'fixture'}),profile);
  activityDispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:profile,database:db,now:()=>Date.now(),mark:()=>({priceUsd:'130',source:'Synthetic smoke quote',atMs:now}),secrets:performanceSecrets,
    brokerPerformanceClientFactory:()=>({account:async()=>({id:'fixture-broker-123456',status:'ACTIVE',currency:'USD',cash:'2000',equity:'104929.64',trading_blocked:false,account_blocked:false}),
      portfolioHistory:async()=>({baseValueUsd:'1000',points:[{atMs:now-13*day,equityUsd:'1000',reportedPnlUsd:'0'},{atMs:now,equityUsd:'104929.64',reportedPnlUsd:'103929.64'}],cashflows:{JNLC:['1000','12190.60']}}),
      allActivities:async()=>[{id:'funding',activity_type:'JNLC',net_amount:'1000',currency:'USD',status:'executed',created_at:new Date(now-13*day).toISOString()},{id:'fill',order_id:'broker-order',activity_type:'FILL',symbol:'BTC/USD',side:'buy',qty:'1',price:'11190.60',transaction_time:new Date(now-day).toISOString()}],
      orders:async()=>[{id:'broker-order',client_order_id:'fixture',symbol:'BTC/USD',side:'buy',status:'filled',qty:'1',filled_qty:'1',filled_avg_price:'11190.60',submitted_at:new Date(now-day).toISOString(),filled_at:new Date(now-day).toISOString()}]})})});
  ipcMain.handle('coqui:query',async(_event,channel,payload)=>{
    counts.set(channel,(counts.get(channel)??0)+1);
    if(channel==='alpaca.paper.performance')return activityDispatch(channel,payload);
    if(channel.startsWith('trading.activity.')&&channel!=='trading.activity.shared'){
      if(channel==='trading.activity.overview'&&failRead)return {status:'failed',issues:[{path:[],code:'synthetic_read_failed'}]};
      const started=globalThis.performance.now();const value=await activityDispatch(channel,payload);readMs.push(globalThis.performance.now()-started);
      if(channel==='trading.activity.overview'&&hold!==null){const pending=hold;hold=null;await pending;}
      return value;
    }
    if(channel==='market-data.products')return {status:'ok',value:{products:['BTC','ETH','ADA'].map(symbol=>({instrument:{venue:'coinbase',productId:`${symbol}-USD`,productType:'spot'},symbol,name:symbol,baseAsset:symbol,quoteAsset:'USD'})),source:'coinbase_exchange_rest',informationalOnly:true,decisionEligible:false,asOfMs:now}};
    if(channel==='market-data.order-book'){const book=new CoinbaseMicrostructure();book.receive({type:'snapshot',product_id:payload.productId,bids:[['129','1']],asks:[['131','2']]},now);return {status:'ok',value:book.book(payload.productId,payload.aggregation,payload.limit,'live',now)};}
    return dispatch(channel,payload);
  });
  window=new BrowserWindow({width:1920,height:1080,show:true,webPreferences:{...WEB_PREFERENCES,preload:join(root,'dist/preload/index.cjs'),backgroundThrottling:false}});
  window.webContents.on('console-message',event=>{if(event.message==="The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.")knownConsoleWarnings.push(event.message);else if(event.level==='error')renderErrors.push(event.message);});
  const file=join(root,'dist/renderer/index.html');applyWindowHardening(window.webContents,pathToFileURL(file).href,shell);
  await window.loadFile(file,{hash:'/overview'});window.focus();window.webContents.focus();
  await waitFor(`document.querySelector('#microstructure-tab-0')?.getAttribute('aria-selected')==='true'`);
  await select('.terminal-microstructure [aria-label="Paper activity source"]','ledger');
  await waitFor(`document.querySelectorAll('.terminal-algo-order').length===20`);
  check('default is Algo Activity with all assets, 7D and Closed P/L',await js(`document.querySelector('#microstructure-tab-0').textContent==='Algo Activity'&&document.querySelector('[aria-label="Activity assets"]').value==='all'&&document.querySelector('[aria-label="Activity period"]').value==='7d'&&document.querySelector('[aria-label="P/L chart mode"] button[aria-pressed="true"]').textContent==='Closed'`));
  check('account selectors share source state with the main chart',await js(`Array.from(document.querySelectorAll('[aria-label="Paper activity source"]')).every(select=>select.value==='ledger')&&document.querySelector('.terminal-microstructure [aria-label="Wallet activity filter"]').disabled`));
  check('chart, metrics and recorded grouped orders render',await js(`document.querySelector('.terminal-pnl-canvas canvas')!==null&&document.querySelectorAll('.terminal-algo-metrics .terminal-metric').length===4&&document.querySelector('.terminal-algo-trades').innerText.includes('2 fills')`));
  await js(`document.querySelector('[aria-label="About Open P/L · now"]').focus()`);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
  await waitFor(`document.querySelector(':popover-open')?.textContent.includes('Unrealized profit or loss')`);
  check('metric information opens with keyboard and explains missing evidence',await js(`document.querySelector(':popover-open').textContent.includes('Missing evidence')`));
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await waitFor(`document.querySelector(':popover-open')===null`);
  check('Escape dismisses information and retains the trigger focus',await js(`document.activeElement?.getAttribute('aria-label')==='About Open P/L · now'`));
  await capture('algo-activity-dark-1920');
  await js(`document.querySelector('.terminal-algo-order-row button[aria-expanded]').click()`);
  await waitFor(`document.querySelector('.terminal-algo-order-detail')?.innerText.includes('Lifetime execution')`);
  await js(`document.querySelector('.terminal-algo-order-row button[aria-expanded="true"]').focus()`);
  const expanded=(await js(`document.querySelector('.terminal-algo-order-row button[aria-expanded="true"]').getAttribute('aria-label')`));
  await delay(5300);
  check('refresh retains expanded order and keyboard focus',await js(`document.activeElement?.getAttribute('aria-label')===${JSON.stringify(expanded)}&&document.querySelector('.terminal-algo-order-detail')!==null`));
  await js(`document.querySelector('.terminal-pnl-canvas').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
  check('chart keyboard inspection exposes an exact observation',await js(`document.querySelector('.terminal-pnl-figure figcaption').textContent.includes('$0.00')`));
  await js(`Array.from(document.querySelectorAll('.terminal-algo-pagination button')).find(button=>button.textContent==='Older trades').click()`);
  await waitFor(`document.querySelectorAll('.terminal-algo-order').length===5`);
  check('grouped orders paginate without replaying the latest page',true);
  await js(`Array.from(document.querySelectorAll('.terminal-algo-pagination button')).find(button=>button.textContent==='Latest trades').click()`);
  await waitFor(`document.querySelectorAll('.terminal-algo-order').length===20`);
  await js(`Array.from(document.querySelectorAll('[aria-label="P/L chart mode"] button')).find(button=>button.textContent==='Total').click()`);
  await waitFor(`document.querySelector('.terminal-algo-chart-heading').innerText.includes('Total P/L')&&document.querySelector('.terminal-pnl-canvas canvas')!==null`);
  check('Total chart uses existing valuations and labels its effective start',await js(`document.querySelector('.terminal-algo-activity').innerText.includes('Since first valid valuation')`));
  const before=counts.get('trading.activity.overview');await click('#microstructure-tab-1');
  await waitFor(`document.querySelector('.terminal-book-table')!==null`);
  check('Order Book retains depth and adds a scoped performance strip',await js(`document.querySelector('.terminal-book-table').innerText.includes('131')&&document.querySelector('.terminal-algo-performance-strip').innerText.includes('Combined simulation')&&document.querySelector('[aria-label="Price aggregation"]')!==null`));
  await capture('order-book-dark-1920');
  await click('.terminal-algo-performance-strip');
  await waitFor(`document.querySelector('[aria-label="P/L chart mode"] button[aria-pressed="true"]')?.textContent==='Total'`);
  check('tab switching preserves chart mode and reuses the overview query',counts.get('trading.activity.overview')===before);
  await select('[aria-label="Activity assets"]','market');await select('[aria-label="Activity period"]','today');
  await waitFor(`document.querySelector('.terminal-algo-context')?.innerText.includes('BTC-USD')&&document.querySelector('.terminal-algo-context')?.innerText.includes('Today')`);
  await select('[aria-label="Activity assets"]','all');await select('[aria-label="Activity period"]','7d');
  // A late response from the prior source must never repaint a different account.
  let release;hold=new Promise(resolve=>{release=resolve;});
  await select('[aria-label="Activity period"]','30d');await delay(100);
  await select('.terminal-microstructure [aria-label="Paper activity source"]',`alpaca_paper:${experiment}`);
  await waitFor(`document.querySelector('.terminal-algo-context')?.innerText.includes('123456')`);release();await delay(250);
  check('source/account change rejects late prior-source display data',await js(`document.querySelector('.terminal-algo-context').innerText.includes('123456')&&!document.querySelector('.terminal-algo-context').innerText.includes('Combined simulation')`));
  check('broker missing fees and Total history remain explicitly unavailable',(await text()).includes('Unavailable')&&(await text()).includes('Two attributable recorded valuations'));
  await waitFor(`document.querySelector('.terminal-algo-broker')?.innerText.includes('$104,929.64')`);
  await click('.terminal-algo-broker summary');
  await waitFor(`document.querySelector('.terminal-algo-broker select')?.options.length===2`);
  check('disconnected capital evidence is not selected automatically',await js(`document.querySelector('.terminal-algo-broker select').value===''&&!document.querySelector('.terminal-algo-broker .capital-performance')`));
  await select('.terminal-algo-broker select',await js(`document.querySelector('.terminal-algo-broker select').options[1].value`));
  await waitFor(`document.querySelector('.terminal-algo-broker .capital-performance')?.innerText.includes('Economic P&L')`);
  const brokerText=await js(`document.querySelector('.terminal-algo-broker').innerText`);
  check('legacy cash proof does not manufacture canonical investment profit',brokerText.includes('$12,190.60')&&brokerText.includes('Legacy execution cash proof reconciled')&&brokerText.includes('Historical evidence only')&&brokerText.includes('initiator and purpose remain unknown')&&!brokerText.includes('$91,739.04')&&await js(`(()=>{const metrics=[...document.querySelectorAll('.terminal-algo-broker .capital-performance .metric-grid>div')];return metrics.length===3&&metrics.every(metric=>metric.querySelector('dd').textContent.includes('Unavailable'));})()`),brokerText);
  check('all account and order metric explanations open individually',await js(`(()=>{const buttons=[...document.querySelectorAll('.terminal-algo-activity .terminal-metric-help button')];const labels=buttons.map(button=>button.getAttribute('aria-label'));const canonical=['Economic P&L','Time-weighted return','Maximum daily drawdown'];const required=['Open P/L · now','Winning / losing exits','Executed orders','Broker account equity','Opening equity','Equity change since opening','Cash adjustments in history','Latest daily history',...canonical];return buttons.length===12&&required.every(label=>labels.includes('About '+label))&&labels.some(label=>label.startsWith('About Realized net ·'))&&buttons.every(button=>{button.click();const open=[...document.querySelectorAll(':popover-open')];const label=button.getAttribute('aria-label').slice(6);return open.length===1&&open[0].querySelector('strong').textContent===label&&open[0].textContent.length>(canonical.includes(label)?20:100);});})()`));
  await click('[aria-label="About Equity change since opening"]');
  await capture('algo-activity-metric-information');
  await js(`document.querySelector(':popover-open').hidePopover()`);
  await capture('algo-activity-alpaca-missing-evidence');
  await select('.terminal-microstructure [aria-label="Paper activity source"]','ledger');await select('[aria-label="Activity period"]','7d');
  await js(`Array.from(document.querySelectorAll('[aria-label="P/L chart mode"] button')).find(button=>button.textContent==='Closed').click()`);
  await waitFor(`document.querySelectorAll('.terminal-algo-order').length===20`);
  const measurements=[];
  for(const [name,theme,width,height,zoom] of [['dark-1920','dark',1920,1080,1],['dark-1440','dark',1440,900,1],['light-1280','light',1280,800,1],['contrast-960','high_contrast',960,900,1],['narrow-640','dark',640,900,1],['zoom-1280','high_contrast',1280,1000,2]]){
    await dispatch('accounts.settings.set',{commandId:globalThis.crypto.randomUUID(),patch:{theme,density:'compact',motion:'none'}});
    window.setContentSize(width,height);window.webContents.setZoomFactor(zoom);
    const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reload();await loaded;window.show();window.focus();window.webContents.focus();await js(`window.focus()`);
    await waitFor(`document.querySelector('.terminal-microstructure [aria-label="Paper activity source"]')!==null`);
    await select('.terminal-microstructure [aria-label="Paper activity source"]','ledger');
    await waitFor(`document.querySelectorAll('.terminal-algo-order').length===20`);
    await js(`document.querySelector('.terminal-microstructure').scrollIntoView({block:'start'})`);
    const geometry=await js(`(()=>{const panel=document.querySelector('.terminal-microstructure');const metrics=panel.querySelector('.terminal-algo-metrics');return {innerWidth,innerHeight,width:panel.clientWidth,scrollWidth:panel.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth,metricsOverflow:metrics.scrollWidth>metrics.clientWidth,figma:Array.from(panel.querySelectorAll('[data-figma-node]')).map(el=>el.dataset.figmaNode),theme:document.documentElement.dataset.theme}})()`);
    check(`${name} compact panel fits without internal clipping`,geometry.scrollWidth<=geometry.width+1&&!geometry.metricsOverflow,JSON.stringify(geometry));
    check(`${name} uses Figma dropdown, badge and row primitives`,['3:56','3:46','3:72'].every(id=>geometry.figma.includes(id)));
    await click('[aria-label="About Open P/L · now"]');
    const helpGeometry=await js(`(()=>{const r=document.querySelector(':popover-open').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
    check(`${name} information remains inside the viewport`,helpGeometry.left>=0&&helpGeometry.right<=helpGeometry.width&&helpGeometry.top>=0&&helpGeometry.bottom<=helpGeometry.height,JSON.stringify(helpGeometry));
    await capture(`algo-activity-information-${name}`);
    await js(`document.querySelector(':popover-open').hidePopover()`);
    measurements.push({name,...geometry});await capture(`algo-activity-${name}`);
    if(name==='dark-1440'){const rect=await js(`(()=>{const r=document.querySelector('.terminal-microstructure').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.min(Math.round(r.height),innerHeight-Math.round(r.y))}})()`);writeFileSync(join(output,'algo-activity-panel.png'),(await window.webContents.capturePage(rect)).toPNG());}
  }
  window.webContents.setZoomFactor(1);window.setContentSize(1440,900);
  await select('[aria-label="Activity assets"]','market');await click('#microstructure-tab-1');
  await select('[aria-label="Order book market"]','ADA-USD');await click('#microstructure-tab-0');
  await waitFor(`document.querySelector('.terminal-algo-trades')?.innerText.includes('No recorded algorithm executions')`);
  check('confirmed empty selection is distinct from an unavailable read',true);
  failRead=true;await select('[aria-label="Activity period"]','30d');
  await waitFor(`document.querySelector('.terminal-microstructure')?.innerText.includes('synthetic_read_failed')`);check('failed reads do not retain another selection’s results',true);failRead=false;
  check('renderer has no uncaught chart or component errors',renderErrors.length===0,renderErrors.join('\n'));
  const sorted=readMs.sort((a,b)=>a-b);const evidence={checks,measurements,counts:Object.fromEntries(counts),readP95Ms:sorted[Math.ceil(sorted.length*.95)-1],knownConsoleWarnings,synthetic:true,valuationRecordingChanged:false};
  writeFileSync(join(output,'smoke.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({checks:checks.length,readP95Ms:evidence.readP95Ms}));
}
app.whenReady().then(run).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{window?.destroy();db?.close();runtime?.dispose();rmSync(directory,{recursive:true,force:true});app.exit(process.exitCode??0);});
