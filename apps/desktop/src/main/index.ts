import { basename, dirname, join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import { createOsKeyringSecretStore } from '@coqui/adapters';
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';

import { createDispatcher } from './dispatch.js';
import { createRuntime, type CoquiRuntime } from './composition.js';
import { createRuntimeProfileController, type RuntimeProfileController } from './profile-runtime.js';
import {
  applyWindowHardening,
  CONTENT_SECURITY_POLICY,
  WEB_PREFERENCES,
  type HardenableWebContents,
} from './security.js';

const QUERY_CHANNEL = 'coqui:query';
const DEFAULT_PROFILE = 'main';
let runtime: RuntimeProfileController | null = null;

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
/**
 * Read the connected CoinGecko key, if there is one.
 *
 * Read here and passed by value, so the key's only journey is
 * keychain → argument → an HTTP client's header. The composition root holds no
 * secret store, which is what makes it structurally impossible for a secret to
 * reach a service or a channel (invariant 3).
 *
 * A keychain that will not open is not a startup failure: the application runs
 * on the public tier and says so.
 */
async function coinGeckoApiKey(): Promise<string | null> {
  try {
    const read = await createOsKeyringSecretStore().read('coingecko-api-key', null);
    return read.ok ? read.value : null;
  } catch {
    return null;
  }
}

/**
 * The OS notifier.
 *
 * Kept behind the `Notifier` interface so the decision of *whether* to notify
 * stays testable without an operating system — `selectNotifiable` is pure, and
 * this is the four lines that cannot be.
 */
const osNotifier = {
  isSupported: () => Notification.isSupported(),
  show(request: { readonly title: string; readonly body: string; readonly silent: boolean }) {
    new Notification({ title: request.title, body: request.body, silent: request.silent }).show();
  },
};

async function start(): Promise<void> {
  const path = databasePath();
  runtime = createRuntimeProfileController({
    dataDirectory: dirname(path),
    legacyDatabaseFilename: basename(path),
    runtime: {
      notifier: osNotifier,
      coinGeckoApiKey: await coinGeckoApiKey(),
      async saveChartSnapshot(filenameStem, png) {
        const result = await dialog.showSaveDialog({
          title: 'Save chart snapshot',
          defaultPath: `${filenameStem}.png`,
          filters: [{ name: 'PNG image', extensions: ['png'] }],
        });
        if (result.canceled || result.filePath === undefined) return 'cancelled';
        await writeFile(result.filePath, png, { flag: 'w' });
        return 'saved';
      },
    },
  });

  const dispatch = createDispatcher({
    handlers: () => runtime?.handlers() ?? {},
    // Detail stays local, and now lands somewhere durable rather than only on
    // a console nobody reads after the fact. It must never travel to the
    // renderer (invariant 3).
    onUnexpectedError: (channel, error) => runtime?.report(`channel:${channel}`, error),
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

/**
 * The ADR-0003 gate, run inside the packaged application.
 *
 * `node:sqlite` working under `vitest` proves the code; it does not prove the
 * *artifact*. Opening a migrated database from inside an asar-packed, ad-hoc
 * signed bundle is a separate claim, and this is where it is checked. It runs
 * headless — no window, no scheduler, no network — so CI can gate on it.
 *
 * Printed as one machine-readable line because the harness parses stdout: a
 * packaged process has nowhere else to report to.
 */
function runPackagedSmoke(): void {
  let payload: { opened: boolean; schemaVersion: number | null; error: string | null };
  let probe: CoquiRuntime | null = null;
  try {
    probe = createRuntime({
      databasePath: databasePath(),
      profileId: DEFAULT_PROFILE,
      disableScheduler: true,
    });
    const row = probe.database.prepare('PRAGMA user_version').get() as { user_version: number };
    payload = { opened: true, schemaVersion: Number(row.user_version), error: null };
  } catch (error) {
    // The error's *type*, not its message: a failure here is reported in CI
    // logs, and a message can carry a path.
    payload = {
      opened: false,
      schemaVersion: null,
      error: error instanceof Error ? error.constructor.name : typeof error,
    };
  } finally {
    probe?.dispose();
  }
  console.log(`COQUI_PACKAGED_SMOKE ${JSON.stringify(payload)}`);
  app.exit(payload.opened ? 0 : 1);
}

app.enableSandbox();

app.on('ready', () => {
  if (process.argv.includes('--packaged-smoke')) {
    runPackagedSmoke();
    return;
  }

  // The window opens after the key read, so the first market request already
  // uses the connected tier rather than falling back and re-fetching.
  void start();

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
