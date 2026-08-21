import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { createDispatcher } from './dispatch.js';
import { createRuntime, type CoquiRuntime } from './composition.js';
import {
  applyWindowHardening,
  CONTENT_SECURITY_POLICY,
  WEB_PREFERENCES,
  type HardenableWebContents,
} from './security.js';

const QUERY_CHANNEL = 'coqui:query';
const DEFAULT_PROFILE = 'main';

let runtime: CoquiRuntime | null = null;

function databasePath(): string {
  // A packaged application has an unpredictable working directory, so the
  // database always resolves against the per-user data directory rather than
  // a relative path that only works when launched from the repository root.
  return process.env['COQUI_DB_PATH'] ?? join(app.getPath('userData'), 'coqui.db');
}

function rendererEntry(): { readonly url?: string; readonly file?: string; readonly origin: string } {
  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer !== undefined && devServer.length > 0) {
    return { url: devServer, origin: new URL(devServer).origin };
  }
  const file = join(import.meta.dirname, '../renderer/index.html');
  return { file, origin: `file://${file}` };
}

function createWindow(): BrowserWindow {
  const entry = rendererEntry();
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0f14',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      ...WEB_PREFERENCES,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
    },
  });

  applyWindowHardening(
    window.webContents as unknown as HardenableWebContents,
    entry.origin,
    shell,
  );

  // Held back until the first paint so the user never sees an empty frame.
  window.once('ready-to-show', () => window.show());

  if (entry.url !== undefined) void window.loadURL(entry.url);
  else void window.loadFile(entry.file!);

  return window;
}

/**
 * Composition root. It wires, it does not decide.
 *
 * `CLAUDE.md` §4 caps this file at 500 lines and forbids business logic here;
 * every behaviour it reaches belongs to a service, and the one thing it owns is
 * the order in which things are created and torn down.
 */
function start(): void {
  runtime = createRuntime({ databasePath: databasePath(), profileId: DEFAULT_PROFILE });

  const dispatch = createDispatcher({
    handlers: runtime.handlers,
    onUnexpectedError: (channel, error) => {
      // Detail stays local. It must never travel to the renderer (invariant 3).
      console.error(`[coqui] channel ${channel} failed`, error);
    },
  });

  ipcMain.handle(QUERY_CHANNEL, async (_event, channel: unknown, payload: unknown) =>
    dispatch(channel, payload),
  );

  createWindow();
}

function shutdown(): void {
  runtime?.dispose();
  runtime = null;
}

app.enableSandbox();

app.on('ready', () => {
  start();

  app.on('activate', () => {
    // Electron owns the window list; keeping a second reference here would
    // only create a way for the two to disagree.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', shutdown);

export { CONTENT_SECURITY_POLICY, QUERY_CHANNEL };
