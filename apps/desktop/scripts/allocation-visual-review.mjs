import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createMemorySecretStore } from '@coqui/adapters';
import { CHANNEL_SCHEMAS } from '@coqui/contracts';
import { createRuntimeProfileController } from '../dist/main/profile-runtime.js';
import { createDispatcher } from '../dist/main/dispatch.js';
import { WEB_PREFERENCES } from '../dist/main/security.js';

// Synthetic, contract-validated portfolio evidence in a disposable profile only.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = process.env.COQUI_ALLOCATION_OUTPUT ?? join(root, '../../docs/design/screenshots/allocation-refinement');
const directory = mkdtempSync(join(tmpdir(), 'coqui-allocation-review-'));
const now = Date.now();
const id = 'a'.repeat(64);
let scenario;
let runtime;
const pair = [['BTC', '4480'], ['USD', '5520']];
const many = [...pair, ['ETH', '800'], ['DOGE', '100'], ['LINK', '50'], ['ADA', '70'], ['LONG-ASSET-SYMBOL-FOR-WRAP-TEST', '30']];
const cases = [
  { name: 'holdings-dark-300px', route: 'holdings', theme: 'dark', width: 1440, data: pair },
  { name: 'holdings-light-1280', route: 'holdings', theme: 'light', width: 1280, data: pair },
  { name: 'holdings-partial-960', route: 'holdings', theme: 'high-contrast', width: 960, data: [...many, ['UNPRICED', null]], partial: true },
  { name: 'holdings-zoom-200', route: 'holdings', theme: 'dark', width: 1280, zoom: 2, data: pair },
  { name: 'holdings-single', route: 'holdings', theme: 'dark', width: 1440, data: [['BTC', '10000']] },
  { name: 'holdings-empty', route: 'holdings', theme: 'light', width: 1280, data: [] },
  { name: 'allocation-dark', route: 'allocation', theme: 'dark', width: 1440, data: pair },
  { name: 'allocation-light-1280', route: 'allocation', theme: 'light', width: 1280, data: many },
  { name: 'allocation-contrast-960', route: 'allocation', theme: 'high-contrast', width: 960, data: many },
  { name: 'allocation-zoom-200', route: 'allocation', theme: 'high-contrast', width: 1280, zoom: 2, data: pair },
  { name: 'allocation-reported-weights', route: 'allocation', theme: 'dark', width: 1280, data: pair, partialWeight: true },
  { name: 'allocation-empty', route: 'allocation', theme: 'dark', width: 1280, data: [] },
];
function fixture(channel) {
  const total = scenario.data.reduce((sum, [, value]) => sum + Number(value ?? 0), 0);
  if (channel === 'portfolio.current') return {
    snapshotId: id, profileId: 'main', asOfMs: now, connectionSnapshotIds: [id],
    exposures: scenario.data.map(([symbol, value]) => ({ exposureKey: symbol, quantity: '1', valueUsd: value,
      contributions: [{ connectionId: id, accountRefId: id, provider: 'coinbase', instrument: null, quantity: '1', valueUsd: value }] })),
    totalValueUsd: scenario.partial ? null : String(total), complete: !scenario.partial, source: 'connected_accounts',
  };
  if (channel === 'portfolio.allocation') return {
    policy: { targets: [], rebalanceBandPct: 5 },
    allocation: { totalValueUsd: String(total), asOf: now, slices: scenario.data.map(([symbol, value], index) => ({
      asset: { instrument: { venue: 'coinbase', productId: `${symbol}-USD`, productType: 'spot' }, symbol, name: symbol, baseAsset: symbol, quoteAsset: 'USD', coingeckoId: null },
      valueUsd: value, actualWeight: scenario.partialWeight ? (index === 0 ? 0.2 : 0.3) : Number(value) / total, targetWeight: null, driftPct: null,
    })) },
    plan: { trades: [], turnoverUsd: '0', maxDriftPct: 0, asOf: now, estimateOnly: true }, planStatus: 'no_policy',
  };
  return undefined;
}
function assert(value, message) { if (!value) throw new Error(message); }
async function run() {
  mkdirSync(output, { recursive: true });
  runtime = createRuntimeProfileController({ dataDirectory: directory, legacyDatabaseFilename: 'coqui.db', disableScheduler: true, runtime: { secrets: createMemorySecretStore() } });
  const dispatch = createDispatcher({ handlers: () => runtime.handlers() });
  await dispatch('app.onboarding.skip', { commandId: randomUUID() });
  ipcMain.handle('coqui:query', (_event, channel, payload) => {
    const value = fixture(channel);
    return value === undefined ? dispatch(channel, payload) : { status: 'ok', value: CHANNEL_SCHEMAS[channel].response.parse(value) };
  });
  const window = new BrowserWindow({ show: false, useContentSize: true, webPreferences: { ...WEB_PREFERENCES, preload: join(root, 'dist/preload/index.cjs'), backgroundThrottling: false } });
  const evaluate = (code) => window.webContents.executeJavaScript(code);
  const reports = [];
  for (scenario of cases.filter(item => !process.env.COQUI_ALLOCATION_FILTER || item.name.startsWith(process.env.COQUI_ALLOCATION_FILTER))) {
    window.setContentSize(scenario.width, 900);
    window.show();
    window.focus();
    window.webContents.focus();
    await dispatch('accounts.settings.set', { commandId: randomUUID(), patch: { theme: scenario.theme.replace('-', '_'), density: 'compact', motion: 'none' } });
    await window.loadFile(join(root, 'dist/renderer/index.html'), { query: { allocationReview: scenario.name }, hash: `/portfolio/${scenario.route}` });
    window.webContents.setZoomFactor(scenario.zoom ?? 1);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(`document.documentElement.dataset.theme === ${JSON.stringify(scenario.theme)} && ${scenario.data.length ? "document.querySelector('.allocation-legend-row') !== null" : "document.body.innerText.includes('Nothing to allocate yet') || document.body.innerText.includes('No priced connected holdings')"}`)) break;
      await delay(100);
    }
    assert(await evaluate('document.querySelector(".route-content") !== null'), `${scenario.name}: route absent`);
    await delay(150);
    const layout = await evaluate(`(() => {
      const chart = document.querySelector('.allocation-chart-container, .allocation-composition');
      if (!chart) return null;
      const bounds = chart.getBoundingClientRect();
      const overflow = [...chart.querySelectorAll('.allocation-ring-visual, .allocation-legend-row, .allocation-composition-bar')].filter(e => { const r=e.getBoundingClientRect(); return r.left < bounds.left-1 || r.right > bounds.right+1 || e.scrollWidth > e.clientWidth+1; }).map(e => e.className);
      return { width: bounds.width, overflow, donutWidth: document.querySelector('.allocation-ring-visual')?.getBoundingClientRect().width, rows: chart.querySelectorAll('.allocation-legend-row').length };
    })()`);
    if (scenario.data.length && (!layout || !layout.rows)) {
      console.log('MISSING', await evaluate('document.body.innerText'));
      writeFileSync(join(output, `${scenario.name}-diagnostic.png`), (await window.webContents.capturePage()).toPNG());
    }
    if (scenario.data.length) {
      assert(layout !== null && layout.rows === scenario.data.filter(([, value]) => value !== null && Number(value) > 0).length, `${scenario.name}: populated chart absent`);
      assert(layout.overflow.length === 0, `${scenario.name}: overflow ${JSON.stringify(layout)}`);
      app.focus({ steal: true });
      window.focus();
      window.webContents.focus();
      await delay(100);
      // Exercise real keyboard activation, then check the corresponding table and detail.
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await delay(50);
      await evaluate(`document.querySelectorAll('.allocation-legend button')[${scenario.data.length > 1 ? 1 : 0}].focus()`);
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
      await delay(100);
      assert(await evaluate(`document.activeElement.matches('.allocation-legend button[aria-pressed="true"]') && (!document.hasFocus() || getComputedStyle(document.activeElement).outlineWidth === '2px')`), `${scenario.name}: keyboard selection/focus failed`);
      assert(await evaluate(`document.querySelector('tr[aria-selected="true"]').innerText.includes(${JSON.stringify(scenario.data[scenario.data.length > 1 ? 1 : 0][0])})`), `${scenario.name}: table selection failed`);
      if (scenario.route === 'holdings') {
        assert(await evaluate(`document.querySelector('.holding-detail h3').textContent === ${JSON.stringify(scenario.data[scenario.data.length > 1 ? 1 : 0][0])}`), `${scenario.name}: detail selection failed`);
        if (scenario.partial) assert(await evaluate(`document.body.innerText.includes('Share of priced holdings')`), 'Partial valuation label absent');
        // Check pointer selection of a Recharts slice as well.
        await evaluate(`document.querySelector('.recharts-pie-sector').dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
        await delay(80);
        assert(await evaluate(`document.querySelector('.allocation-legend button').getAttribute('aria-pressed') === 'true'`), `${scenario.name}: donut selection failed`);
      } else {
        await evaluate(`document.querySelector('.allocation-composition-bar button').click()`);
        await delay(80);
        assert(await evaluate(`document.querySelector('.allocation-legend button').getAttribute('aria-pressed') === 'true'`), `${scenario.name}: segment selection failed`);
        if (scenario.partialWeight) assert(await evaluate(`document.querySelector('.allocation-composition-bar button').style.width === '20%' && document.querySelector('.allocation-legend strong').textContent === '20.0%'`), 'Reported weights were normalized');
      }
      await evaluate(`document.activeElement.blur(); document.querySelector('.allocation-chart-container, .allocation-composition').scrollIntoView({block:'end'})`);
      if (scenario.route === 'allocation') assert(await evaluate(`(() => { const bar=document.querySelector('.allocation-composition-bar').getBoundingClientRect(); return [...document.querySelectorAll('.allocation-composition-bar button')].every(e => e.getBoundingClientRect().height <= bar.height + 1); })()`), `${scenario.name}: segments exceed bar height`);
    }
    writeFileSync(join(output, `${scenario.name}.png`), (await window.webContents.capturePage()).toPNG());
    reports.push({ name: scenario.name, ...layout });
    console.log(`PASS ${scenario.name} ${JSON.stringify(layout)}`);
  }
  writeFileSync(join(output, 'verification.json'), JSON.stringify(reports, null, 2));
  window.destroy();
}
app.enableSandbox();
app.whenReady().then(async () => {
  let code = 0;
  try { await run(); } catch (error) { console.error(error); code = 1; }
  finally { runtime?.dispose(); rmSync(directory, { recursive: true, force: true }); app.exit(code); }
});
