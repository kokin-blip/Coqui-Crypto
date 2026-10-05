import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout, setInterval, clearInterval } from 'node:timers';
import { activityFixture } from './terminal-activity-fixture.mjs';
import { randomUUID } from 'node:crypto';

// Deterministic feed fixtures are confined to this isolated benchmark process.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { createRuntimeProfileController } = await import(join(root, 'dist/main/profile-runtime.js'));
const { createDispatcher } = await import(join(root, 'dist/main/dispatch.js'));
const { CoinbaseMicrostructure } = await import(join(root, 'dist/main/coinbase-microstructure.js'));
const { WEB_PREFERENCES } = await import(join(root, 'dist/main/security.js'));
const seconds = Number(process.env.COQUI_PERF_SECONDS ?? 60);
const intervalMs = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '6h': 21600000, '1d': 86400000 };
app.enableSandbox();
app.whenReady().then(async () => {
const directory = mkdtempSync(join(tmpdir(), 'coqui-terminal-perf-'));
const runtime = createRuntimeProfileController({ dataDirectory: directory, legacyDatabaseFilename: 'coqui.db', disableScheduler: true, runtime: {} });
const dispatch = createDispatcher({ handlers: () => runtime.handlers() });
const activity=process.env.COQUI_PERF_ACTIVITY==='1'?activityFixture(join(directory,'coqui.db')):null;
await dispatch('app.onboarding.skip', { commandId: randomUUID() });
await dispatch('accounts.workspace.set', { commandId: randomUUID(), patch: { marketInterval: '5m', marketLiveCandle: true } });
const step5m=300000;const end5m=Math.floor(Date.now()/step5m)*step5m;
const drawingResult=await dispatch('app.chart.workspace.set',{commandId:randomUUID(),action:{kind:'save_drawing',drawing:{id:randomUUID(),productId:'BTC-USD',interval:'5m',layoutId:null,kind:'vertical',points:[{timeMs:end5m-30*step5m,value:'84200'}],label:'Viewport preservation probe'}}});
if(drawingResult.status!=='ok')throw new Error('Cannot seed viewport probe');
const histories = new Map();
let ticks = 0, feedTicks = 0, bookQueries = 0, tradeQueries = 0, historyQueries = 0, extensionEvaluations = 0;
const microstructure = new CoinbaseMicrostructure();
microstructure.receive({type:'snapshot',product_id:'BTC-USD',bids:[['84199','1'],['84198','2']],asks:[['84201','1'],['84202','2']]},Date.now());
const feed = setInterval(()=>{feedTicks++;const now=Date.now();microstructure.receive({type:'l2update',product_id:'BTC-USD',changes:[['buy','84199',String(1+feedTicks%5)]]},now);microstructure.receive({type:'match',product_id:'BTC-USD',trade_id:feedTicks,side:feedTicks%2?'buy':'sell',price:String(84200+feedTicks%2),size:'0.01'},now);},1000);
ipcMain.handle('coqui:query', async (_event, channel, payload) => {
  if(activity!==null&&['trading.activity.summary','trading.activity.scopes','trading.activity.trail'].includes(channel))return activity.dispatch(channel,payload);
  if (channel === 'market-data.display-bars') {
    historyQueries++;
    const step = intervalMs[payload.interval];
    const end = Math.floor(Date.now() / step) * step;
    const bars = Array.from({ length: 2000 }, (_, i) => ({ productId: payload.productId, interval: payload.interval,
      startTimeMs: end - (2000 - i) * step, endTimeMs: end - (1999 - i) * step,
      open: String(84000 + i / 10), high: String(84002 + i / 10), low: String(83998 + i / 10), close: String(84001 + i / 10),
      volume: '2', isComplete: true, retrievedAtMs: end, informationalOnly: true, decisionEligible: false }));
    histories.set(payload.interval, end);
    return { status: 'ok', value: { productId: payload.productId, interval: payload.interval, bars,
      source: 'coinbase_exchange_rest', completeness: 'completed_only', informationalOnly: true, decisionEligible: false, asOfMs: end } };
  }
  if (channel === 'market-data.live-candles') {
    ticks++;
    const step = intervalMs[payload.interval];
    const start = histories.get(payload.interval) ?? Math.floor(Date.now() / step) * step;
    return { status: 'ok', value: { connection: 'live', candles: payload.productIds.map(productId => ({ productId, interval: payload.interval,
      startTimeMs: start, endTimeMs: start + step, open: '84200', high: '84210', low: '84190', close: String(84200 + ticks % 10), volume: String(ticks),
      isComplete: false, observedAtMs: Date.now(), informationalOnly: true, decisionEligible: false })), informationalOnly: true, decisionEligible: false, asOfMs: Date.now() } };
  }
  if(channel==='chart-extensions.catalog')return {status:'ok',value:{signers:[],extensions:[{id:'benchmark.overlay',name:'Benchmark overlay',version:'1.0.0',author:'Local performance harness',license:'MIT',signerKeyId:'a'.repeat(64),payloadHash:'b'.repeat(64),enabled:true,settings:{},compatibility:{min:'0.1.0',maxExclusive:'1.0.0'},permissions:['immutable_display_bars'],settingsSchema:[],outputs:[{id:'benchmark.line',kind:'series',title:'Benchmark line',pane:0,color:'#969da8'}],installedAtMs:0}]}};
  if(channel==='chart-extensions.evaluate'){extensionEvaluations++;return {status:'ok',value:{series:[{id:'benchmark.line',title:'Benchmark line',pane:0,color:'#969da8',points:payload.bars.map(b=>({timeMs:b.timeMs,value:b.close}))}],markers:[],informationalOnly:true,decisionEligible:false}};}
  if(channel==='market-data.order-book'){bookQueries++;return {status:'ok',value:microstructure.book(payload.productId,payload.aggregation,payload.limit,'live',Date.now())};}
  if(channel==='market-data.recent-trades'){tradeQueries++;return {status:'ok',value:microstructure.trades(payload.productId,payload.limit,'live',Date.now())};}
  if (channel === 'market-data.products') return { status: 'ok', value: { products: [{ instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' }, symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteAsset: 'USD' }], source: 'coinbase_exchange_rest', informationalOnly: true, decisionEligible: false, asOfMs: Date.now() } };
  if (channel.startsWith('market-data.') && !['market-data.live', 'market-data.order-book', 'market-data.recent-trades'].includes(channel)) return { status: 'failed', issues: [{ path: [], code: 'benchmark_unavailable' }] };
  return dispatch(channel, payload);
});
const window = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { ...WEB_PREFERENCES, backgroundThrottling: false, preload: join(root, 'dist/preload/index.cjs') } });
const evaluate = code => window.webContents.executeJavaScript(code);
const wait = predicate => evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+15000;const check=()=>{if(${predicate})resolve(true);else if(performance.now()>end)reject(new Error('Terminal timeout: '+${JSON.stringify(predicate)}));else requestAnimationFrame(check)};check()})`);
try {
  if(process.env.COQUI_PERF_DEV_URL)await window.loadURL(`${process.env.COQUI_PERF_DEV_URL}/#/settings`);
  else await window.loadFile(join(root, 'dist/renderer/index.html'), { hash: '/settings' });
  await wait('document.querySelector(".app-shell")');
  const coldStart = Date.now();
  await evaluate("location.hash='/overview'");
  await wait('document.querySelector(".trading-workstation-chart canvas")');
  const coldChartMs = Date.now() - coldStart;
  const navigation = [];
  for (let i = 0; i < 12; i++) {
    await evaluate("location.hash='/settings'");
    await wait('!document.querySelector(".terminal-workspace")');
    const start = Date.now();
    await evaluate("location.hash='/overview'");
    await wait('document.querySelector(".trading-workstation-chart canvas")');
    navigation.push(Date.now() - start);
  }
  if(activity!==null){await evaluate("document.querySelector('#terminal-data-tab-1').click()");await wait("document.querySelector('.chart-evidence-list')?.textContent.includes('+9.00') && document.querySelector('.terminal-execution-trail')?.textContent.includes('fixture-close')");}
  await wait("document.querySelector('.chart-drawing-layer line')!==null");
  const oldX=await evaluate("Number(document.querySelector('.chart-drawing-layer line').getAttribute('x1'))");
  const pointer=await evaluate("(()=>{const r=document.querySelector('.chart-canvas').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  window.webContents.sendInputEvent({type:'mouseWheel',...pointer,deltaX:0,deltaY:-120,canScroll:true});
  await new Promise(resolve=>setTimeout(resolve,250));
  const viewportX=await evaluate("Number(document.querySelector('.chart-drawing-layer line').getAttribute('x1'))");
  if(Math.abs(viewportX-oldX)<1)throw new Error('Viewport probe did not zoom');
  await evaluate(`window.__terminalRemoved=0; window.__terminalLongTasks=[];
    window.__terminalObserver=new MutationObserver(records=>{for(const r of records)for(const n of r.removedNodes)if(n.nodeType===1)window.__terminalRemoved+=(n.matches?.('canvas')?1:0)+(n.querySelectorAll?.('canvas').length??0)});
    window.__terminalObserver.observe(document.querySelector('.terminal-price-panel'),{childList:true,subtree:true});
    window.__terminalPerfObserver=new PerformanceObserver(list=>window.__terminalLongTasks.push(...list.getEntries().map(e=>e.duration)));
    window.__terminalPerfObserver.observe({type:'longtask',buffered:false});`);
  const evaluationsBeforeFeed=extensionEvaluations;
  // Each wait is short so the caller can collect progress while the benchmark runs.
  for (let i = 0; i < seconds; i++) {if(i===Math.floor(seconds/2))await evaluate("document.querySelector('#microstructure-tab-1').click()");await new Promise(resolve => setTimeout(resolve, 1000));}
  const updates = await evaluate('({removedCanvases:window.__terminalRemoved,longTasks:window.__terminalLongTasks})');
  const finalX=await evaluate("Number(document.querySelector('.chart-drawing-layer line').getAttribute('x1'))");
  const viewportDriftPx=Math.abs(finalX-viewportX);
  const p75 = navigation.sort((a,b)=>a-b)[Math.ceil(navigation.length*.75)-1];
  const result = { coldChartMs, cachedNavigationP75Ms: p75, feedSeconds: seconds, ticks, feedTicks, bookQueries, tradeQueries, historyQueries, unchangedExtensionEvaluations:extensionEvaluations-evaluationsBeforeFeed, viewportDriftPx, ...updates };
  if(process.env.COQUI_PERF_OUTPUT){mkdirSync(process.env.COQUI_PERF_OUTPUT,{recursive:true});for(const [width,height] of [[1920,1080],[1440,900],[1280,800]]){window.setContentSize(width,height);await new Promise(resolve=>setTimeout(resolve,250));writeFileSync(join(process.env.COQUI_PERF_OUTPUT,`terminal-activity-${width}.png`),(await window.webContents.capturePage()).toPNG());}}
  console.log(JSON.stringify(result));
  if (process.env.COQUI_PERF_BASELINE !== '1' && (p75 > 200 || viewportDriftPx > .5 || extensionEvaluations-evaluationsBeforeFeed > 1 || updates.removedCanvases > 0 || updates.longTasks.some(ms=>ms>200))) process.exitCode = 1;
} finally {
  clearInterval(feed); window.destroy(); activity?.dispose(); runtime.dispose(); rmSync(directory, { recursive: true, force: true }); app.exit(process.exitCode ?? 0);
}

}).catch(error => { console.error(error); app.exit(1); });
