import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMemorySecretStore } from '@coqui/adapters';
import { openDatabase, getProfileConnectionV2, setConnectionRemoval, saveNewsObservation } from '@coqui/storage';
import { NewsIntelligenceService } from '@coqui/services';
import { coinbaseEvidenceDatasetHash } from '@coqui/core';
import { assertNoTextClipping } from './visual-overflow-audit.mjs';

/**
 * Deterministic visual-review capture for the production renderer.
 *
 * The harness uses a migrated throwaway profile and the production dispatcher;
 * it never edits DOM content or presents fixture financial outcomes as real.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = dirname(dirname(root));
const output = process.env['COQUI_VISUAL_OUTPUT'] ?? join(repository, 'docs/design/screenshots/review-2026-09-09-responsive');
const entry = join(root, 'dist/renderer/index.html');

if (!existsSync(entry)) {
  console.error('[coqui] production renderer missing — run the desktop build first.');
  process.exit(1);
}

const { createRuntimeProfileController } = await import(pathToFileURL(join(root, 'dist/main/profile-runtime.js')).href);
const { createDispatcher } = await import(pathToFileURL(join(root, 'dist/main/dispatch.js')).href);
const { applyWindowHardening, WEB_PREFERENCES } = await import(pathToFileURL(join(root, 'dist/main/security.js')).href);

const remainingRoutes = ['settings','portfolio/holdings','portfolio/allocation','portfolio/tax','portfolio/reconciliation','paper/overview','paper/orders','paper/performance','strategies','research','events','activity','risk'];
const capturePlan = [
  ...[{route:'events',action:'news-detail'},{route:'settings',action:'news-health'},{route:'research'}].flatMap(item => [
    {...item,name:`news-${item.route}-desktop`,mode:'advanced',theme:'dark',density:'compact',zoom:1,width:1440,height:900},
    {...item,name:`news-${item.route}-contrast-zoom`,mode:'advanced',theme:'high-contrast',density:'compact',zoom:2,width:1280,height:800,motion:'reduced'},
  ]),
  ...remainingRoutes.flatMap(route=>[
    {name:`remaining-${route.replaceAll('/','-')}-desktop`,route,mode:'advanced',theme:'dark',density:'compact',zoom:1,width:1440,height:900},
    {name:`remaining-${route.replaceAll('/','-')}-light`,route,mode:'advanced',theme:'light',density:'compact',zoom:1,width:1280,height:800},
    {name:`remaining-${route.replaceAll('/','-')}-contrast`,route,mode:'advanced',theme:'high-contrast',density:'compact',zoom:1,width:960,height:640,motion:'reduced'},
    {name:`remaining-${route.replaceAll('/','-')}-zoom`,route,mode:'advanced',theme:'high-contrast',density:'compact',zoom:2,width:1280,height:800,motion:'reduced'},
  ]),
  ...['dark','light','high-contrast'].flatMap(theme=>[
    {name:`remaining-removal-${theme}`,route:'settings',mode:'advanced',theme,density:'compact',zoom:theme==='high-contrast'?2:1,width:1280,height:800,coinbaseState:'connected',action:'remove-connector'},
    {name:`remaining-nickname-${theme}`,route:'settings',mode:'advanced',theme,density:'compact',zoom:theme==='high-contrast'?2:1,width:1280,height:800,coinbaseState:'connected'},
  ]),
  {name:'remaining-removal-blocked',route:'settings',mode:'advanced',theme:'dark',density:'compact',zoom:1,width:1280,height:800,coinbaseState:'connected',action:'remove-connector',lifecycleState:'blocked'},
  {name:'remaining-removal-recovery',route:'settings',mode:'advanced',theme:'light',density:'compact',zoom:1,width:1280,height:800,coinbaseState:'connected',action:'remove-connector',lifecycleState:'pending'},
  {name:'remaining-nickname-add',route:'settings',mode:'advanced',theme:'light',density:'compact',zoom:1,width:1280,height:800,coinbaseState:'connected',clearNickname:true},
  ...['Assets', 'Paper Positions', 'Paper Proposals', 'Decisions', 'Performance', 'Research Runs', 'Depth Chart', 'Recent Trades'].map((tab) => ({ name: `terminal-${tab.toLowerCase().replaceAll(' ', '-')}-1920x1080`, route: 'overview', mode: 'advanced', theme: 'dark', density: 'compact', zoom: 1, width: 1920, height: 1080, action: `tab:${tab}` })),
  { name: 'terminal-drawer-1440x900', route: 'overview', mode: 'simple', theme: 'dark', density: 'compact', zoom: 1, width: 1440, height: 900, action: 'terminal-drawer' },
  { name: 'terminal-1280x800', route: 'overview', mode: 'advanced', theme: 'dark', density: 'compact', zoom: 1, width: 1280, height: 800 },
  { name: 'terminal-960x640', route: 'overview', mode: 'simple', theme: 'dark', density: 'compact', zoom: 1, width: 960, height: 640 },
  { name: 'terminal-light-1440x900', route: 'overview', mode: 'advanced', theme: 'light', density: 'compact', zoom: 1, width: 1440, height: 900 },
  { name: 'terminal-high-contrast-1280x800', route: 'overview', mode: 'advanced', theme: 'high-contrast', density: 'compact', zoom: 1, width: 1280, height: 800 },
  { name: 'overview-compact-960x640', route: 'overview', mode: 'simple', theme: 'dark', density: 'comfortable', zoom: 1, width: 960, height: 640 },
  { name: 'markets-standard-1280x800', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, width: 1280, height: 800 },
  { name: 'markets-simple-1280x800', route: 'markets', mode: 'simple', theme: 'dark', density: 'comfortable', zoom: 1, width: 1280, height: 800 },
  { name: 'markets-diagnostics', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, width: 1280, height: 800, scrollTarget: '.coinbase-market-context' },
  { name: 'settings-standard-1440x900', route: 'settings', mode: 'advanced', theme: 'light', density: 'comfortable', zoom: 1, width: 1440, height: 900 },
  { name: 'research-wide-1728x1117-inspector', route: 'research', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, width: 1728, height: 1117, inspectorOpen: true },
  { name: 'risk-200-percent', route: 'risk', mode: 'advanced', theme: 'high-contrast', density: 'compact', zoom: 2, width: 1280, height: 800 },
  { name: 'research-grid-dark', route: 'overview', mode: 'advanced', preset: 'research_grid', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'research-grid-light', route: 'overview', mode: 'advanced', preset: 'research_grid', theme: 'light', density: 'comfortable', zoom: 1 },
  { name: 'chart-focus-dark', route: 'overview', mode: 'advanced', preset: 'chart_focus', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'evidence-review-dark', route: 'overview', mode: 'advanced', preset: 'evidence_review', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'simple-overview-dark', route: 'overview', mode: 'simple', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'simple-overview-light', route: 'overview', mode: 'simple', theme: 'light', density: 'comfortable', zoom: 1 },
  { name: 'advanced-portfolio-light', route: 'portfolio/holdings', mode: 'advanced', theme: 'light', density: 'comfortable', zoom: 1 },
  { name: 'simple-portfolio-allocation', route: 'portfolio/holdings', mode: 'simple', theme: 'dark', density: 'comfortable', zoom: 1, portfolioChart: 'allocation' },
  { name: 'advanced-portfolio-allocation', route: 'portfolio/allocation', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'advanced-portfolio-tax', route: 'portfolio/tax', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'advanced-portfolio-reconciliation', route: 'portfolio/reconciliation', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'advanced-paper-overview', route: 'paper/overview', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'advanced-paper-orders', route: 'paper/orders', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'advanced-strategies', route: 'strategies', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'advanced-research', route: 'research', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'advanced-settings', route: 'settings', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'coinbase-settings-disconnected', route: 'settings', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'coinbase-settings-intermediate', route: 'settings', mode: 'simple', theme: 'light', density: 'comfortable', zoom: 1, width: 1100 },
  { name: 'coinbase-settings-200-percent', route: 'settings', mode: 'advanced', theme: 'dark', density: 'compact', zoom: 2 },
  { name: 'coinbase-settings-connected', route: 'settings', mode: 'advanced', theme: 'light', density: 'comfortable', zoom: 1, coinbaseState: 'connected' },
  { name: 'coinbase-sync-result', route: 'settings', mode: 'advanced', theme: 'dark', density: 'compact', zoom: 1, coinbaseState: 'connected', action: 'coinbase-sync' },
  { name: 'coinbase-settings-attention', route: 'settings', mode: 'advanced', theme: 'high-contrast', density: 'comfortable', zoom: 1, coinbaseState: 'attention' },
  { name: 'risk-high-contrast', route: 'risk', mode: 'advanced', theme: 'high-contrast', density: 'comfortable', zoom: 1 },
  { name: 'markets-compact-offline', route: 'markets', mode: 'advanced', theme: 'dark', density: 'compact', zoom: 1 },
  { name: 'markets-single-chart', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, marketLayout: 'single' },
  { name: 'markets-light', route: 'markets', mode: 'advanced', theme: 'light', density: 'comfortable', zoom: 1, marketLayout: 'single' },
  { name: 'markets-four-chart-grid', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, marketLayout: 'single', action: 'grid' },
  { name: 'markets-indicator-controls', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, marketLayout: 'single', action: 'indicators' },
  { name: 'markets-drawing-tools', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, marketLayout: 'single', action: 'drawing' },
  { name: 'markets-comparison-unavailable', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, marketLayout: 'single' },
  { name: 'chart-extension-manager', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, marketLayout: 'single', action: 'extensions' },
  { name: 'advisor-local-facts', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, marketLayout: 'single', action: 'local-facts' },
  { name: 'advisor-chat-disconnected', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, marketLayout: 'single', action: 'analyst' },
  { name: 'markets-reduced-motion', route: 'markets', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, marketLayout: 'single', motion: 'reduced' },
  { name: 'overview-200-percent', route: 'overview', mode: 'advanced', preset: 'research_grid', theme: 'dark', density: 'compact', zoom: 2 },
  { name: 'research-negative-evidence', route: 'research', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, scrollTarget: '[data-finding-id="trendvol-replacement-v1"]' },
  { name: 'activity-empty-evidence', route: 'activity', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'operations-dark-1440x900', route: 'activity', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, width: 1440, height: 900 },
  { name: 'operations-light-1280x800', route: 'activity', mode: 'simple', theme: 'light', density: 'comfortable', zoom: 1, width: 1280, height: 800 },
  { name: 'operations-compact', route: 'activity', mode: 'advanced', theme: 'dark', density: 'compact', zoom: 1, width: 1280, height: 800 },
  { name: 'operations-high-contrast', route: 'activity', mode: 'advanced', theme: 'high-contrast', density: 'comfortable', zoom: 1, width: 1280, height: 800 },
  { name: 'operations-reduced-motion', route: 'activity', mode: 'simple', theme: 'dark', density: 'comfortable', motion: 'reduced', zoom: 1, width: 1280, height: 800 },
  { name: 'operations-200-percent', route: 'activity', mode: 'advanced', theme: 'dark', density: 'compact', zoom: 2, width: 1440, height: 900 },
  { name: 'performance-empty-evidence', route: 'paper/performance', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
];
const captureFilter = process.env['COQUI_VISUAL_FILTER'];
const captures = captureFilter === undefined ? capturePlan : capturePlan.filter(({ name }) => name.startsWith(captureFilter));

const dataDirectory = mkdtempSync(join(tmpdir(), 'coqui-visual-review-'));
const secrets = createMemorySecretStore();
let runtime;

async function waitForReady(window) {
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const heading = document.querySelector('[data-route-heading]');
        const statusReady = !document.body.innerText.includes('MODE UNKNOWN');
        if ((heading && statusReady) || performance.now() - started > 5000) resolve(Boolean(heading && statusReady));
        else requestAnimationFrame(check);
      };
      check();
    })
  `);
  await delay(350);
}

async function run() {
  mkdirSync(output, { recursive: true });
  runtime = createRuntimeProfileController({
    dataDirectory,
    legacyDatabaseFilename: 'coqui.db',
    disableScheduler: true,
    coinbaseVerifier: { verify: async () => ({ ok: true, portfolioUuid: '22222222-2222-4222-8222-222222222222' }) },
    runtime: {
      secrets,
      coinbaseAcquirer: {
        acquire: async () => ({
          ok: true,
          value: {
            accounts: [], fills: [], transactions: [], feeTier: null,
            accountPageCount: 1, fillPageCount: 1, transactionPageCount: 0,
            datasetHash: coinbaseEvidenceDatasetHash([], []),
          },
        }),
      },
    },
  });
  if (captureFilter?.startsWith('news-')) {
    const database = openDatabase(join(dataDirectory, 'coqui.db')), now = Date.now();
    database.prepare('INSERT OR IGNORE INTO canonical_instruments VALUES (?,?,?,?,?,?,?,?,?)').run('coinbase','BTC-USD','spot','BTC','Bitcoin','BTC','USD',now-600000,now-600000);
    saveNewsObservation({ schemaVersion:1,provider:'gdelt',providerArticleId:null,title:'Synthetic research fixture: Bitcoin upgrade approved; Ethereum outage',
      url:'https://synthetic.example/research-fixture',sourceDomain:'synthetic.example',description:'Synthetic metadata for visual verification. Bitcoin adoption gains while Ethereum declines.',
      publishedAtMs:null,providerObservedAtMs:null,observedAtMs:now-60000,language:'English',entities:[] },now-60000,database);
    new NewsIntelligenceService({database,clock:{nowMs:()=>now}}).analyze({schemaVersion:1,reviewedAtMs:now-600000,instruments:[{asset:'BTC',instrument:{venue:'coinbase',productId:'BTC-USD',productType:'spot'}}],publisherAliases:[]});
    database.close();
  }
  const dispatch = createDispatcher({ handlers: () => runtime.handlers() });
  if (process.env['COQUI_VISUAL_DISMISS_ONBOARDING'] === '1') {
    const skipped = await dispatch('app.onboarding.skip', { commandId: randomUUID() });
    if (skipped.status !== 'ok') throw new Error('Could not dismiss onboarding in the temporary visual profile.');
  }
  ipcMain.handle('coqui:query', async (_event, channel, payload) => dispatch(channel, payload));

  const window = new BrowserWindow({
    show: false,
    width: 1536,
    height: 1024,
    useContentSize: true,
    backgroundColor: '#050914',
    webPreferences: {
      ...WEB_PREFERENCES,
      preload: join(root, 'dist/preload/index.cjs'),
      backgroundThrottling: false,
    },
  });
  applyWindowHardening(window.webContents, pathToFileURL(entry).href, shell);

  for (const [index, capture] of captures.entries()) {
    window.setContentSize(capture.width ?? 1536, capture.height ?? 1024);
    const appearance = await dispatch('accounts.settings.set', {
      commandId: randomUUID(),
      patch: { theme: capture.theme.replace('-', '_'), density: capture.density, motion: capture.motion ?? 'none' },
    });
    if (appearance.status !== 'ok') throw new Error(`Could not prepare appearance for ${capture.name}.`);
    if (capture.mode !== undefined) {
      const workspaceOutcome = await dispatch('accounts.workspace.set', {
        commandId: randomUUID(),
        patch: {
          workspaceMode: capture.mode,
          ...(capture.preset === undefined ? {} : {
            advancedOverviewPreset: capture.preset,
            advancedOverviewPanels: capture.preset === 'chart_focus'
              ? { strategyDetail: false, strategyComparison: true, recentActivity: false, proposalPreview: true, healthStrip: true, negativeFindings: false }
              : capture.preset === 'evidence_review'
                ? { strategyDetail: true, strategyComparison: true, recentActivity: true, proposalPreview: false, healthStrip: false, negativeFindings: true }
                : { strategyDetail: true, strategyComparison: true, recentActivity: true, proposalPreview: true, healthStrip: true, negativeFindings: true },
          }),
          ...(capture.portfolioChart === undefined ? {} : { portfolioChart: capture.portfolioChart }),
          ...(capture.marketLayout === undefined ? {} : { marketLayout: capture.marketLayout }),
          ...(capture.inspectorOpen === undefined ? {} : { inspectorOpen: capture.inspectorOpen }),
        },
      });
      if (workspaceOutcome.status !== 'ok') {
        throw new Error(`Could not prepare ${capture.mode} workspace capture: ${workspaceOutcome.issues.map((issue) => issue.code).join(',')}`);
      }
      const confirmedWorkspace = await dispatch('accounts.workspace', {});
      if (confirmedWorkspace.status !== 'ok' || confirmedWorkspace.value.preferences.workspaceMode !== capture.mode) {
        throw new Error(`Workspace capture mode did not persist for ${capture.name}.`);
      }
    }
    if (capture.coinbaseState === 'connected') {
      const status = await dispatch('accounts.coinbase.status', {});
      if (status.status !== 'ok' || status.value.state !== 'connected') {
        const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const connected = await dispatch('accounts.coinbase.connect-json', {
          commandId: randomUUID(),
          contents: JSON.stringify({
            name: 'organizations/visual-review/apiKeys/view-only',
            privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
          }),
        });
        if (connected.status !== 'ok') throw new Error(`Could not prepare Coinbase connection for ${capture.name}.`);
      }
    }
    if(capture.coinbaseState === 'connected' && capture.name.startsWith('remaining-')) {
      const connections=await dispatch('connections.list',{});
      if(connections.status!=='ok'||!connections.value.connections[0])throw new Error('Visual connector missing');
      // Reset a prior disposable recovery fixture before the next verified sync.
      const resetDb=openDatabase(join(dataDirectory,'coqui.db'));
      resetDb.prepare('DELETE FROM execution_leases_v1 WHERE profile_id=?').run('main');
      setConnectionRemoval(getProfileConnectionV2('main',connections.value.connections[0].id,resetDb),'visual-reset','reactivated',Date.now(),resetDb);resetDb.close();
      const synced=await dispatch('connections.sync',{commandId:randomUUID(),connectionId:connections.value.connections[0].id});
      if(synced.status!=='ok')throw new Error('Visual identity verification failed');
      const wallets=await dispatch('wallets.list',{});
      if(wallets.status!=='ok'||!wallets.value.wallets[0])throw new Error('Visual wallet mapping missing');
      const named=await dispatch('wallets.nickname.set',{commandId:randomUUID(),walletId:wallets.value.wallets[0].id,nickname:capture.clearNickname?null:'Illustrative local wallet',revision:wallets.value.revision});
      if(named.status!=='ok')throw new Error('Visual nickname persistence failed');
      // State fixtures live only in this disposable visual database.
      const fixtureDb=openDatabase(join(dataDirectory,'coqui.db'));
      fixtureDb.prepare('DELETE FROM execution_leases_v1 WHERE profile_id=?').run('main');
      const connection=getProfileConnectionV2('main',connections.value.connections[0].id,fixtureDb);
      setConnectionRemoval(connection,'visual-fixture',capture.lifecycleState==='pending'?'pending':'reactivated',Date.now(),fixtureDb);
      if(capture.lifecycleState==='blocked')fixtureDb.prepare('INSERT INTO execution_leases_v1 VALUES(?,?,?,?,?)').run('main','visual-fixture',Date.now()+3600000,1,Date.now());
      fixtureDb.close();
    }
    if (capture.coinbaseState === 'attention') {
      await secrets.remove('coinbase-credentials', runtime.activeProfile().id);
    }
    if (index === 0) {
      await window.loadFile(entry, { hash: `/${capture.route}` });
    } else {
      await window.webContents.executeJavaScript(
        `window.location.hash = ${JSON.stringify(`/${capture.route}`)}`,
      );
      const loaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
      window.webContents.reload();
      await loaded;
    }
    await window.webContents.setZoomFactor(capture.zoom);
    await waitForReady(window);
    if (capture.name.startsWith('terminal-')) {
      // Wait for the real history query to settle; never substitute chart data.
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await window.webContents.executeJavaScript(`document.querySelector('.workstation-chart-loading') === null`)) break;
        await delay(50);
      }
    }
    if (process.env['COQUI_VISUAL_DISMISS_ONBOARDING'] === '1') {
      await window.webContents.executeJavaScript(`
        [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Not now')?.click()
      `);
      await delay(100);
    }
    const layout = await window.webContents.executeJavaScript(`({ shell: document.querySelector('.app-shell')?.className, viewport: [innerWidth, innerHeight], workspace: document.querySelector('.app-workspace')?.getBoundingClientRect().width, route: document.querySelector('.route-content')?.getBoundingClientRect().width })`);
    console.log(`LAYOUT    ${capture.name} ${JSON.stringify(layout)}`);
    await window.webContents.executeJavaScript(`
      (() => {
        const target = ${JSON.stringify(capture.scrollTarget ?? (capture.name.startsWith('coinbase-') ? '.coinbase-settings' : null))};
        if (target === null) window.scrollTo(0, 0);
        else {
          document.querySelector(target)?.scrollIntoView({ block: 'start' });
          document.querySelector('.route-content')?.scrollBy(0, -160);
        }
      })()
    `);
    if (capture.action !== undefined) {
      await window.webContents.executeJavaScript(`
        (() => {
          const action = ${JSON.stringify(capture.action)};
          const buttons = [...document.querySelectorAll('button')];
          if (action.startsWith('tab:')) buttons.find((button) => button.getAttribute('role') === 'tab' && button.textContent?.trim() === action.slice(4))?.click();
          if (action === 'terminal-drawer') buttons.find((button) => button.getAttribute('aria-label') === 'Open algorithm and evidence')?.click();
          if (action === 'grid') {
            const select = [...document.querySelectorAll('select')].find((item) => [...item.options].some((option) => option.value === 'grid'));
            if (select) { select.value = 'grid'; select.dispatchEvent(new Event('change', { bubbles: true })); }
          }
          if (action === 'indicators') document.querySelector('.chart-options-popover')?.setAttribute('open', '');
          if (action === 'drawing') buttons.find((button) => button.getAttribute('aria-label') === 'Trend line')?.click();
          if (action === 'extensions') buttons.find((button) => button.textContent?.includes('Extensions'))?.click();
          if (action === 'analyst' || action === 'local-facts') buttons.find((button) => button.textContent?.includes('Ask Coqui analyst'))?.click();
          if (action === 'local-facts') setTimeout(() => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Generate local facts'))?.click(), 25);
          if (action === 'remove-connector') buttons.find((button)=>['Remove connector','Recover removal'].includes(button.textContent?.trim()))?.click();
          if (action === 'coinbase-sync') buttons.find((button) => button.textContent?.includes('Sync now'))?.click();
        })()
      `);
      await delay(capture.action === 'local-facts' || capture.action === 'coinbase-sync' || capture.action === 'remove-connector' ? 250 : 80);
      if(capture.action==='remove-connector'&&!await window.webContents.executeJavaScript('document.querySelector("dialog[open]") !== null'))throw new Error('Removal dialog missing from visual capture');
    }
    if (capture.action === 'news-detail') {
      window.show(); window.focus(); window.webContents.focus();
      await delay(80);
      const focused = await window.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === 'Inspect news evidence'); b?.focus(); return !!b && document.activeElement === b; })()`);
      if (!focused) throw new Error('News evidence keyboard control missing');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await delay(100);
      if (!await window.webContents.executeJavaScript(`document.activeElement?.getAttribute('aria-expanded') === 'true'`)) throw new Error('News evidence keyboard expansion failed');
    }
    if (capture.action === 'news-health') {
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Diagnostics')?.click()`);
      await delay(100);
    }
    await delay(50);
    const appearanceMatches = await window.webContents.executeJavaScript(`document.documentElement.dataset.theme === ${JSON.stringify(capture.theme)} && document.documentElement.dataset.density === ${JSON.stringify(capture.density)}`);
    if (!appearanceMatches) throw new Error(`Renderer appearance did not settle for ${capture.name}.`);
    if (capture.name.startsWith('coinbase-') || capture.name.startsWith('remaining-nickname-')) {
      await window.webContents.executeJavaScript(`document.querySelector('.coinbase-settings')?.scrollIntoView({block: 'end'})`);
      await delay(80);
    }
    await assertNoTextClipping(window.webContents, capture.name);
    const image = await window.webContents.capturePage();
    writeFileSync(join(output, `${capture.name}.png`), image.toPNG());
    console.log(`CAPTURED  ${capture.name}.png`);
  }

  window.destroy();
}

app.enableSandbox();
app.whenReady().then(async () => {
  try {
    await run();
    console.log(`\nVisual review set: ${output}`);
    app.exit(0);
  } catch (error) {
    console.error(`[coqui] visual-review capture failed: ${error?.stack ?? error}`);
    app.exit(1);
  } finally {
    runtime?.dispose();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});
