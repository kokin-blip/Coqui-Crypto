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
const output = join(repository, 'docs/implementation/evidence/p2-budget-feasibility-2026-10-23/ui');
const directory = mkdtempSync(join(tmpdir(), 'coqui-p2-ui-'));
app.setPath('userData', join(directory, 'browser')); app.setPath('sessionData', join(directory, 'browser'));
const { createRuntimeProfileController } = await import('../dist/main/profile-runtime.js');
const { createDispatcher } = await import('../dist/main/dispatch.js');
const { applyWindowHardening, WEB_PREFERENCES } = await import('../dist/main/security.js');
let runtime, database, window;
const checks = [], rendererErrors = [], browserNotices = [];
function check(name, passed, detail = '') { checks.push({ name, passed, detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!passed) throw new Error(name); }
const js = source => window.webContents.executeJavaScript(source);
async function waitFor(source) { for (let count = 0; count < 100; count++) { if (await js(source)) return; await delay(100); } throw new Error(`P2 UI wait failed: ${source}`); }
async function run() {
  mkdirSync(output, { recursive: true });
  globalThis.WebSocket = class { close() {} send() {} };
  globalThis.fetch = async () => new globalThis.Response('{}', { status: 503 });
  await seedCoinbaseSmokeProfile(directory);
  runtime = createRuntimeProfileController({ dataDirectory: directory, legacyDatabaseFilename: 'coqui.db', disableScheduler: true, runtime: {} });
  database = openDatabase(join(directory, 'coqui.db'));
  const profileId = runtime.activeProfile().id, now = Date.now(), identity = capitalHash('synthetic-p2-ui-account');
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
  let loaded = false;
  for (const [name, theme, width, height, zoom] of [
    ['desktop-dark', 'dark', 1440, 1000, 1], ['narrow-light', 'light', 640, 900, 1], ['contrast-zoom', 'high_contrast', 1280, 1000, 2],
  ]) {
    await dispatch('accounts.settings.set', { commandId: globalThis.crypto.randomUUID(), patch: { theme, density: 'compact', motion: 'none' } });
    window.setContentSize(width, height); window.webContents.setZoomFactor(zoom);
    if (loaded) { const finished = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await finished; }
    else { await window.loadFile(entry, { hash: '/portfolio/allocation' }); loaded = true; }
    window.focus(); window.webContents.focus();
    await waitFor(`document.querySelector('.capital-feasibility')?.innerText.includes('Observed cash')`);
    await waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme.replace('_', '-'))}`);
    const text = await js(`document.querySelector('.capital-feasibility').innerText`);
    check(`${name}: cash survives unavailable ownership`, text.includes('$500.00') && text.includes('Capacity unavailable'));
    await js(`document.querySelector('.capital-scenario').open = true; document.querySelector('.capital-scenario button[type=submit]').focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await waitFor(`document.querySelector('.capital-feasibility-result')?.innerText.includes('infeasible')`);
    check(`${name}: scenario names its assumptions`, (await js(`document.querySelector('.capital-scenario').innerText`)).includes('0.25%'));
    await js(`document.querySelector('.capital-feasibility').scrollIntoView({block:'start'})`);
    await assertNoTextClipping(window.webContents, `p2-${name}`);
    writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.capital-feasibility [aria-label="About Cash after obligations"]').focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await waitFor(`document.querySelector(':popover-open')?.innerText.includes('separate ceilings')`);
    const box = await js(`(()=>{const r=document.querySelector(':popover-open').getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
    check(`${name}: keyboard help fits viewport`, box.left >= 0 && box.right <= box.width && box.top >= 0 && box.bottom <= box.height, JSON.stringify(box));
    writeFileSync(join(output, `${name}-help.png`), (await window.webContents.capturePage()).toPNG());
    await delay(100);
    await js(`document.querySelector(':popover-open')?.hidePopover()`);
    await waitFor(`!document.querySelector(':popover-open')`);
    await js(`document.querySelector('.capital-feasibility-result').scrollIntoView({block:'start'})`);
    await delay(100);
    await assertNoTextClipping(window.webContents, `p2-${name}-result`);
    writeFileSync(join(output, `${name}-result.png`), (await window.webContents.capturePage()).toPNG());
  }
  const before = database.prepare('SELECT total_changes() AS n').get();
  const request = { mode: 'scenario', scopeId: null, capitalUsd: '1000', tradeUsd: '25', minimumQuantity: '0.01', quantityIncrement: '0.01' };
  const response = await js(`window.coqui.query('capital.feasibility',${JSON.stringify(request)})`);
  check('new channel passes production preload', response.status === 'ok' && response.value.state === 'feasible' && response.value.executionEligible === false);
  await js(`window.coqui.query('capital.budget',${JSON.stringify({ scopeId })})`);
  check('reads do not change durable state', JSON.stringify(before) === JSON.stringify(database.prepare('SELECT total_changes() AS n').get()));
  const gate = await dispatch('risk.evidence-gate', {});
  check('live authority remains disabled', gate.status === 'ok' && gate.value.liveExecutionPermitted === false);
  check('no renderer component errors', rendererErrors.length === 0, rendererErrors.join('; '));
  writeFileSync(join(output, 'smoke.json'), JSON.stringify({ synthetic: true, accountAccess: false, checks, rendererErrors, browserNotices }, null, 2) + '\n');
}
app.whenReady().then(run).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  window?.destroy(); database?.close(); runtime?.dispose(); rmSync(directory, { recursive: true, force: true }); app.exit(process.exitCode ?? 0);
});
