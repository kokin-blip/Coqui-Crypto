import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

/**
 * Deterministic visual-review capture for the production renderer.
 *
 * The harness uses a migrated throwaway profile and the production dispatcher;
 * it never edits DOM content or presents fixture financial outcomes as real.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = dirname(dirname(root));
const output = join(repository, 'docs/design/screenshots/review-2026-08-27');
const entry = join(root, 'dist/renderer/index.html');

if (!existsSync(entry)) {
  console.error('[coqui] production renderer missing — run the desktop build first.');
  process.exit(1);
}

const { createRuntimeProfileController } = await import(join(root, 'dist/main/profile-runtime.js'));
const { createDispatcher } = await import(join(root, 'dist/main/dispatch.js'));
const { applyWindowHardening, WEB_PREFERENCES } = await import(join(root, 'dist/main/security.js'));

const captures = [
  { name: 'overview-dark', route: 'overview', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'portfolio-light', route: 'portfolio/holdings', theme: 'light', density: 'comfortable', zoom: 1 },
  { name: 'risk-high-contrast', route: 'risk', theme: 'high-contrast', density: 'comfortable', zoom: 1 },
  { name: 'markets-compact-offline', route: 'markets', theme: 'dark', density: 'compact', zoom: 1 },
  { name: 'overview-200-percent', route: 'overview', theme: 'dark', density: 'compact', zoom: 2 },
  { name: 'research-negative-evidence', route: 'research', theme: 'dark', density: 'comfortable', zoom: 1, scrollTarget: '[data-finding-id="trendvol-replacement-v1"]' },
  { name: 'activity-empty-evidence', route: 'activity', theme: 'dark', density: 'comfortable', zoom: 1 },
  { name: 'performance-empty-evidence', route: 'paper/performance', theme: 'dark', density: 'comfortable', zoom: 1 },
];

const dataDirectory = mkdtempSync(join(tmpdir(), 'coqui-visual-review-'));
let runtime;

async function waitForReady(window) {
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const heading = document.querySelector('[data-route-heading]');
        if (heading || performance.now() - started > 5000) resolve(Boolean(heading));
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
    width: 1280,
    height: 800,
    backgroundColor: '#050914',
    webPreferences: {
      ...WEB_PREFERENCES,
      preload: join(root, 'dist/preload/index.cjs'),
      backgroundThrottling: false,
    },
  });
  applyWindowHardening(window.webContents, `file://${entry}`, shell);

  for (const [index, capture] of captures.entries()) {
    await window.webContents.setZoomFactor(capture.zoom);
    if (index === 0) {
      const loaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
      window.loadFile(entry, { hash: `/${capture.route}` }).catch(() => {});
      await loaded;
    } else {
      await window.webContents.executeJavaScript(
        `window.location.hash = ${JSON.stringify(`/${capture.route}`)}`,
      );
      await delay(150);
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
