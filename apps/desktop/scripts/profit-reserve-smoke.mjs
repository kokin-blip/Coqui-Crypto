import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { budgetEvidence, capitalHash, capitalScopeId, unknownNativeRule } from '@coqui/core';
import { openDatabase, saveBudgetSource, saveCapitalBinding, saveCapitalScope } from '@coqui/storage';
import { seedCoinbaseSmokeProfile } from './coinbase-settings-smoke.mjs';
import { assertNoTextClipping } from './visual-overflow-audit.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url))), repository = dirname(dirname(root));
const output = join(repository, 'docs/implementation/evidence/p3-reserve-2026-10-23/ui');
const directory = mkdtempSync(join(tmpdir(), 'coqui-p3-ui-'));
app.setPath('userData', join(directory, 'browser')); app.setPath('sessionData', join(directory, 'browser'));
const { createRuntimeProfileController } = await import('../dist/main/profile-runtime.js');
const { createDispatcher } = await import('../dist/main/dispatch.js');
const { applyWindowHardening, WEB_PREFERENCES } = await import('../dist/main/security.js');
let runtime, database, window;
const checks = [], rendererErrors = [], browserNotices = [];
function check(name, passed, detail = '') { checks.push({ name, passed, detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!passed) throw new Error(name); }
const js = source => window.webContents.executeJavaScript(source);
async function waitFor(source) { for (let count = 0; count < 100; count++) { if (await js(source)) return; await delay(100); } throw new Error(`P3 UI wait failed: ${source}`); }
async function run() {
  mkdirSync(output, { recursive: true });
  globalThis.WebSocket = class { close() {} send() {} };
  globalThis.fetch = async () => new globalThis.Response('{}', { status: 503 });
  await seedCoinbaseSmokeProfile(directory);
  runtime = createRuntimeProfileController({ dataDirectory: directory, legacyDatabaseFilename: 'coqui.db', disableScheduler: true, runtime: {} });
  database = openDatabase(join(directory, 'coqui.db'));
  const profileId = runtime.activeProfile().id, now = Date.now(), identity = capitalHash('synthetic-p3-ui-account');
  const scopeId = capitalScopeId('local_paper', 'simulation', identity);
  saveCapitalScope({ id: scopeId, provider: 'local_paper', environment: 'simulation', currency: 'USD', accountIdentityHash: identity,
    originProfileId: profileId, createdAtMs: now }, database);
  saveCapitalBinding({ profileId, scopeId, connectionId: null, mode: 'active', lastBatchId: null }, database);
  saveBudgetSource(budgetEvidence({ scopeId, bookId: identity, provider: 'local_paper', environment: 'simulation', observedAtMs: now,
    expiresAtMs: now + 30_000, cashUsd: '500', equityUsd: '500', positions: {}, marks: {}, quotes: {}, ruleIds: [], fees: null,
    venueEligibleUsd: unknownNativeRule('synthetic_no_provider_authority'), complete: true, holdMatchingComplete: false, authority: 'unproven',
    assurance: 'scenario', reasonCodes: [], evidenceRefs: ['synthetic_ui_fixture_no_account_access'] }), database);
  const dispatch = createDispatcher({ handlers: () => runtime.handlers() });
  await dispatch('app.onboarding.skip', { commandId: globalThis.crypto.randomUUID() });
  ipcMain.handle('coqui:query', async (_event, channel, payload) => dispatch(channel, payload));
  const entry = join(root, 'dist/renderer/index.html');
  window = new BrowserWindow({ show: true, width: 1440, height: 1000, useContentSize: true,
    webPreferences: { ...WEB_PREFERENCES, preload: join(root, 'dist/preload/index.cjs'), backgroundThrottling: false } });
  window.webContents.on('console-message', event => {
    if (event.message === "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.") browserNotices.push(event.message);
    else if (event.level === 'error') rendererErrors.push(event.message);
  });
  applyWindowHardening(window.webContents, pathToFileURL(entry).href, shell);
  let loaded=false;
  for(const [name,theme,width,height,zoom] of [['desktop-dark','dark',1440,1000,1],['narrow-light','light',640,900,1],['contrast-zoom','high_contrast',1280,1000,2]]){
    await dispatch('accounts.settings.set',{commandId:globalThis.crypto.randomUUID(),patch:{theme,density:'compact',motion:'none'}});
    window.setContentSize(width,height);window.webContents.setZoomFactor(zoom);
    if(loaded){const finished=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reload();await finished;}
    else{await window.loadFile(entry,{hash:'/portfolio/allocation'});loaded=true;}
    window.focus();window.webContents.focus();
    await waitFor(`document.querySelector('.profit-reserves')?.innerText.includes('Observed account cash')`);
    await waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme.replace('_','-'))}`);
    check(`${name}: observed cash survives incomplete performance`,(await js(`document.querySelector('.reserve-account').innerText`)).includes('$500.00'));
    await js(`document.querySelector('.reserve-scenario').open=true;document.querySelector('.reserve-scenario button[type=submit]').focus()`);
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
    await waitFor(`document.querySelector('.reserve-scenario .reserve-result')?.innerText.includes('Preview consequence: eligible')`);
    const resultText=await js(`document.querySelector('.reserve-scenario .reserve-result').innerText`);
    check(`${name}: exact hypothetical cents and retained capital`,resultText.includes('$12.50')&&resultText.includes('$537.50')&&resultText.includes('No cash was reserved'));
    await js(`document.querySelector('.reserve-scenario').scrollIntoView({block:'start'})`);await assertNoTextClipping(window.webContents,`p3-${name}-form`);
    writeFileSync(join(output,`${name}-form.png`),(await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.reserve-scenario .reserve-result').scrollIntoView({block:'start'})`);await delay(100);await assertNoTextClipping(window.webContents,`p3-${name}-result`);
    writeFileSync(join(output,`${name}-result.png`),(await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.reserve-scenario [aria-label="About Additional modeled reserve"]').focus()`);
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
    await waitFor(`document.querySelector(':popover-open')?.innerText.includes('capped by')`);
    const box=await js(`(()=>{const r=document.querySelector(':popover-open').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
    check(`${name}: keyboard help fits viewport`,box.left>=0&&box.right<=box.width&&box.top>=0&&box.bottom<=box.height,JSON.stringify(box));
    writeFileSync(join(output,`${name}-help.png`),(await window.webContents.capturePage()).toPNG());
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await waitFor(`!document.querySelector(':popover-open')`);
    check(`${name}: help returns keyboard focus`,(await js(`document.activeElement?.getAttribute('aria-label')`))==='About Additional modeled reserve');
    await js(`(()=>{const el=document.querySelector('.reserve-scenario input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'600');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await waitFor(`!document.querySelector('.reserve-scenario .reserve-result')`);check(`${name}: editing invalidates the previous result`,true);
  }
  function snapshot(includePreview=true){
    const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'capital_%' OR name IN('paper_orders_v3','paper_fills_v3','paper_ledger_entries_v3','research_preregistrations')) ORDER BY name").all().map(r=>r.name).filter(n=>includePreview||!n.startsWith('capital_reserve_'));
    return JSON.stringify(tables.map(table=>[table,database.prepare(`SELECT * FROM ${table}`).all()]));
  }
  const before=snapshot(),settings={goal:'preview',trigger:{kind:'profit_usd',value:'50'},shareBps:2500,retainedCapitalUsd:'500',minimumBatchUsd:'1',cadence:'manual',reviewWinCount:null,taxHold:{amountUsd:'0',backing:'principal'}};
  const request={mode:'scenario',openingUsd:'500',profitUsd:'50',realizedProfitUsd:'50',cashUsd:'550',externalExpenseUsd:'0',settings};
  const response=await js(`window.coqui.query('capital.reserve.preview',${JSON.stringify(request)})`);
  check('preview crosses production preload without authority',response.status==='ok'&&response.value.report.state==='eligible'&&response.value.report.executionEligible===false);
  await js(`window.coqui.query('capital.reserve.view',${JSON.stringify({scopeId})})`);check('read routes leave durable capital and financial evidence unchanged',before===snapshot());
  const financialBefore=snapshot(false),view=await dispatch('capital.reserve.view',{scopeId});
  const save={commandId:globalThis.crypto.randomUUID(),scopeId,expectedPolicyId:view.value.policy?.id??null,expectedStateId:view.value.state?.id??null,expectedInputHash:view.value.financial.sourceCutHash,settings};
  const saved=await js(`window.coqui.query('capital.reserve.settings.save',${JSON.stringify(save)})`);
  check('save records only preview configuration',saved.status==='ok'&&saved.value.state.reservedUsd==='0'&&saved.value.policy.settings.goal==='preview');
  const inspect={commandId:globalThis.crypto.randomUUID(),scopeId,expectedPolicyId:saved.value.policy.id,expectedStateId:saved.value.state.id,expectedInputHash:saved.value.financial.sourceCutHash};
  const inspected=await js(`window.coqui.query('capital.reserve.inspect',${JSON.stringify(inspect)})`);
  check('inspection preserves unavailable account evidence',inspected.status==='ok'&&inspected.value.report.state==='unavailable');
  check('settings and inspection do not write financial state',financialBefore===snapshot(false));
  const retry=await js(`window.coqui.query('capital.reserve.inspect',${JSON.stringify(inspect)})`);
  check('inspection retry returns original identity',retry.status==='ok'&&retry.value.id===inspected.value.id);
  check('no financial action controls',await js(`![...document.querySelectorAll('.profit-reserves button')].some(b=>/^(Withdraw|Pay|Execute|Commit reserve)/i.test(b.innerText))`));
  const gate = await dispatch('risk.evidence-gate', {});
  check('live authority remains disabled', gate.status === 'ok' && gate.value.liveExecutionPermitted === false);
  check('no renderer component errors', rendererErrors.length === 0, rendererErrors.join('; '));
  writeFileSync(join(output, 'smoke.json'), JSON.stringify({ synthetic: true, accountAccess: false, checks, rendererErrors, browserNotices }, null, 2) + '\n');
}
app.whenReady().then(run).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  window?.destroy(); database?.close(); runtime?.dispose(); rmSync(directory, { recursive: true, force: true }); app.exit(process.exitCode ?? 0);
});
