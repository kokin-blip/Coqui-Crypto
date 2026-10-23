import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { capitalHash, capitalScopeId } from '@coqui/core';
import { ingestCapitalEvidence } from '@coqui/services';
import { openDatabase } from '@coqui/storage';
import { seedCoinbaseSmokeProfile } from './coinbase-settings-smoke.mjs';
import { assertNoTextClipping } from './visual-overflow-audit.mjs';

// Disposable synthetic observations through production services, IPC, preload and renderer. No account access.
const root = dirname(dirname(fileURLToPath(import.meta.url))), repository = dirname(dirname(root));
const output = join(repository, 'docs/implementation/evidence/capital-accounting-2026-10-23/ui');
const directory = mkdtempSync(join(tmpdir(), 'coqui-capital-smoke-'));
app.setPath('userData', join(directory, 'browser')); app.setPath('sessionData', join(directory, 'browser'));
const { createRuntimeProfileController } = await import('../dist/main/profile-runtime.js');
const { createDispatcher } = await import('../dist/main/dispatch.js');
const { applyWindowHardening, WEB_PREFERENCES } = await import('../dist/main/security.js');
let runtime, database, window;
const checks = [], rendererErrors = [], browserNotices = [];
function check(name, passed, detail = '') {
  checks.push({ name, passed, detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  if (!passed) throw new Error(name);
}
const js = (source) => window.webContents.executeJavaScript(source);
async function waitFor(source) {
  for (let count = 0; count < 100; count += 1) { if (await js(source)) return; await delay(100); }
  throw new Error(`Capital smoke wait failed: ${source}`);
}
async function run() {
  mkdirSync(output, { recursive: true });
  globalThis.WebSocket = class { close() {} send() {} };
  globalThis.fetch = async () => new globalThis.Response('{}', { status: 503 });
  await seedCoinbaseSmokeProfile(directory);
  runtime = createRuntimeProfileController({ dataDirectory: directory, legacyDatabaseFilename: 'coqui.db', disableScheduler: true, runtime: {} });
  database = openDatabase(join(directory, 'coqui.db'));
  const profileId = runtime.activeProfile().id, end = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  const start = end - 2 * 86_400_000, identity = capitalHash('synthetic-capital-smoke-account');
  const scope = { id: capitalScopeId('local_paper', 'simulation', identity), provider: 'local_paper', environment: 'simulation',
    currency: 'USD', accountIdentityHash: identity, originProfileId: profileId, createdAtMs: start };
  const batch = { id: capitalHash('synthetic-capital-smoke-batch'), scopeId: scope.id, source: 'synthetic-native-smoke-v1',
    requestedAtMs: end, observedAtMs: end, recordedAtMs: end,
    coverage: { fromMs: start, toMs: end, complete: true, paginationComplete: true, membershipComplete: true, reasonCodes: [] },
    memberIdentityHashes: [identity], evidenceRefs: ['synthetic-fixture'], payload: { synthetic: true, accountAccess: false } };
  const valuations = ['500', '525', '550'].map((equityUsd, index) => ({
    id: capitalHash({ synthetic: true, index }), scopeId: scope.id, sourceBatchId: batch.id, replacesId: null,
    atMs: start + index * 86_400_000, sequence: 0, observedAtMs: end, equityUsd, cashUsd: equityUsd,
    legs: [], verified: true, missingComponents: [], evidenceRefs: ['synthetic-fixture'],
  }));
  ingestCapitalEvidence({ profileId, connectionId: null, scope, batch, events: [], valuations,
    opening: { valuationId: valuations[0].id, reason: 'verified_origin', historicalLimitations: ['synthetic_smoke_fixture'] } }, database);
  const dispatch = createDispatcher({ handlers: () => runtime.handlers() });
  await dispatch('app.onboarding.skip', { commandId: globalThis.crypto.randomUUID() });
  ipcMain.handle('coqui:query', async (_event, channel, payload) => dispatch(channel, payload));
  const entry = join(root, 'dist/renderer/index.html');
  window = new BrowserWindow({ show: true, width: 1440, height: 1000, useContentSize: true,
    webPreferences: { ...WEB_PREFERENCES, preload: join(root, 'dist/preload/index.cjs'), backgroundThrottling: false } });
  window.webContents.on('console-message', (event) => {
    if (event.message === "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.") browserNotices.push(event.message);
    else if (event.level === 'error') rendererErrors.push(event.message);
  });
  applyWindowHardening(window.webContents, pathToFileURL(entry).href, shell);
  let loadedOnce = false;
  for (const [name, theme, width, height, zoom] of [
    ['desktop-dark', 'dark', 1440, 1000, 1], ['narrow-light', 'light', 640, 900, 1], ['contrast-zoom', 'high_contrast', 1280, 1000, 2],
  ]) {
    const appearance = await dispatch('accounts.settings.set', { commandId: globalThis.crypto.randomUUID(), patch: { theme, density: 'compact', motion: 'none' } });
    check(`${name}: appearance settings accepted`, appearance.status === 'ok');
    window.setContentSize(width, height); window.webContents.setZoomFactor(zoom);
    if (loadedOnce) {
      const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
      window.webContents.reload(); await loaded;
    } else { await window.loadFile(entry, { hash: '/paper/performance' }); loadedOnce = true; }
    window.focus(); window.webContents.focus();
    await waitFor(`document.querySelector('.capital-performance')?.innerText.includes('Economic P&L')`);
    await waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme.replace('_', '-'))} && document.documentElement.dataset.density === 'compact'`);
    const body = await js(`document.querySelector('.capital-performance').innerText`);
    check(`${name}: corrected dollar profit and return visible`, body.includes('$50.00') && body.includes('10%'));
    check(`${name}: missing basis and annualization remain unavailable`, body.includes('Unavailable') && body.includes('Tracking since'));
    await js(`document.querySelector('.capital-performance').scrollIntoView({block:'start'})`);
    await assertNoTextClipping(window.webContents, `capital-${name}`);
    await delay(150); writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.capital-performance [aria-label="About Annualized return"]').focus()`);
    check(`${name}: unavailable evidence help is keyboard focusable`, await js(`document.activeElement?.getAttribute('aria-label') === 'About Annualized return'`));
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await waitFor(`[...document.querySelectorAll(':popover-open')].some(element => element.innerText.includes('365 elapsed days'))`);
    const geometry = await js(`(()=>{const r=document.querySelector(':popover-open').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
    check(`${name}: help fits viewport`, geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height, JSON.stringify(geometry));
    await delay(100); writeFileSync(join(output, `${name}-help.png`), (await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector(':popover-open').hidePopover()`);
    await js(`document.querySelector('.capital-performance details').open = true`);
    await assertNoTextClipping(window.webContents, `capital-${name}-details`);
  }
  const before = database.prepare('SELECT total_changes() AS n').get();
  const response = await js(`window.coqui.query('capital.performance',${JSON.stringify({ scopeId: scope.id, epochId: null, fromMs: null, toMs: null })})`);
  check('capital performance round-trips through production preload', response.status === 'ok' && response.value.calculationVersion === 'capital-flow-performance-v1');
  check('capital read leaves durable state unchanged', JSON.stringify(before) === JSON.stringify(database.prepare('SELECT total_changes() AS n').get()));
  const gate = await dispatch('risk.evidence-gate', {});
  check('live authority remains disabled', gate.status === 'ok' && gate.value.liveExecutionPermitted === false);
  check('renderer has no uncaught component errors', rendererErrors.length === 0, rendererErrors.join('; '));
  writeFileSync(join(output, 'smoke.json'), JSON.stringify({ synthetic: true, accountAccess: false, checks, rendererErrors, browserNotices }, null, 2) + '\n');
}
app.whenReady().then(run).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  window?.destroy(); database?.close(); runtime?.dispose(); rmSync(directory, { recursive: true, force: true }); app.exit(process.exitCode ?? 0);
});
