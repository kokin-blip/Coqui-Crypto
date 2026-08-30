import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertNoTextClipping } from './visual-overflow-audit.mjs';

/**
 * Deterministic visual-review capture for the production renderer.
 *
 * The harness uses a migrated throwaway profile and the production dispatcher;
 * it never edits DOM content or presents fixture financial outcomes as real.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = dirname(dirname(root));
const output = join(repository, 'docs/design/screenshots/review-2026-08-30-advanced-fidelity');
const entry = join(root, 'dist/renderer/index.html');

if (!existsSync(entry)) {
  console.error('[coqui] production renderer missing — run the desktop build first.');
  process.exit(1);
}

const { createRuntimeProfileController } = await import(join(root, 'dist/main/profile-runtime.js'));
const { createDispatcher } = await import(join(root, 'dist/main/dispatch.js'));
const { applyWindowHardening, WEB_PREFERENCES } = await import(join(root, 'dist/main/security.js'));

const captures = [
  { name: 'research-grid-dark', route: 'overview', mode: 'advanced', preset: 'research_grid', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'research-grid-light', route: 'overview', mode: 'advanced', preset: 'research_grid', theme: 'light', density: 'comfortable', zoom: 1 },
  { name: 'chart-focus-dark', route: 'overview', mode: 'advanced', preset: 'chart_focus', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'evidence-review-dark', route: 'overview', mode: 'advanced', preset: 'evidence_review', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'simple-overview-dark', route: 'overview', mode: 'simple', theme: 'dark', density: 'comfortable', zoom: 1 },
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
  { name: 'risk-high-contrast', route: 'risk', mode: 'advanced', theme: 'high-contrast', density: 'comfortable', zoom: 1 },
  { name: 'markets-compact-offline', route: 'markets', mode: 'advanced', theme: 'dark', density: 'compact', zoom: 1 },
  { name: 'overview-200-percent', route: 'overview', mode: 'advanced', preset: 'research_grid', theme: 'dark', density: 'compact', zoom: 2 },
  { name: 'research-negative-evidence', route: 'research', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1, scrollTarget: '[data-finding-id="trendvol-replacement-v1"]' },
  { name: 'activity-empty-evidence', route: 'activity', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'performance-empty-evidence', route: 'paper/performance', mode: 'advanced', theme: 'dark', density: 'comfortable', zoom: 1 },
];

const dataDirectory = mkdtempSync(join(tmpdir(), 'coqui-visual-review-'));
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
    runtime: {},
  });
  const dispatch = createDispatcher({ handlers: () => runtime.handlers() });
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
  applyWindowHardening(window.webContents, `file://${entry}`, shell);

  for (const [index, capture] of captures.entries()) {
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
    await window.webContents.setZoomFactor(capture.zoom);
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
    await waitForReady(window);
    await window.webContents.executeJavaScript(`
      (() => {
        document.documentElement.dataset.theme = ${JSON.stringify(capture.theme)};
        document.documentElement.dataset.density = ${JSON.stringify(capture.density)};
        document.documentElement.dataset.motion = 'none';
        const target = ${JSON.stringify(capture.scrollTarget ?? null)};
        if (target === null) window.scrollTo(0, 0);
        else {
          document.querySelector(target)?.scrollIntoView({ block: 'start' });
          document.querySelector('.route-content')?.scrollBy(0, -160);
        }
      })()
    `);
    await delay(50);
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
