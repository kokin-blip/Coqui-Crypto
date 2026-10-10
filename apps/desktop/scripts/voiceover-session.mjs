import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout } from 'node:timers';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMemorySecretStore } from '@coqui/adapters';
import { isWriteChannel } from '@coqui/contracts';
import { createRuntimeProfileController } from '../dist/main/profile-runtime.js';
import { createDispatcher } from '../dist/main/dispatch.js';
import { applyWindowHardening, WEB_PREFERENCES } from '../dist/main/security.js';

// Human-operated accessibility session; never enables VoiceOver or claims an operator pass.
const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const smokeCheck = process.argv.includes('--smoke-check');
const data = mkdtempSync(join(tmpdir(), 'coqui-voiceover-disposable-'));
app.setPath('userData', data); app.setPath('sessionData', data);
globalThis.fetch = async () => new globalThis.Response('{}', { status: 503 });
globalThis.WebSocket = class { close() {} send() {} };
let controller, window, nameOutcome = 'normal', refuseSkip = false;
function cleanup() { controller?.dispose(); controller = null; rmSync(data, { recursive: true, force: true }); }
app.on('will-quit', cleanup);
app.whenReady().then(async () => {
  controller = createRuntimeProfileController({ dataDirectory: data, legacyDatabaseFilename: 'coqui.db',
    disableScheduler: true, runtime: { secrets: createMemorySecretStore() } });
  const dispatch = createDispatcher({ handlers: () => controller.handlers() });
  ipcMain.handle('coqui:query', async (_event, channel, payload) => {
    if (isWriteChannel(channel) && !['app.person.set', 'app.onboarding.skip', 'app.onboarding.restart', 'app.onboarding.complete'].includes(channel)) {
      return { status: 'blocked', issues: [{ path: [], code: 'accessibility_fixture_scope' }] };
    }
    if (channel === 'app.onboarding.status' || channel === 'app.profile-readiness') await new Promise(resolve => setTimeout(resolve, 600));
    if (channel === 'app.person.set' && nameOutcome !== 'normal') return { status: nameOutcome,
      issues: [{ path: [], code: nameOutcome === 'blocked' ? 'fixture_name_refused' : 'fixture_name_unknown' }] };
    if (channel === 'app.onboarding.skip' && refuseSkip) { refuseSkip = false; return { status: 'failed', issues: [{ path: [], code: 'fixture_skip_refused' }] }; }
    return dispatch(channel, payload);
  });
  window = new BrowserWindow({ show: !smokeCheck, title: 'Coqui — disposable VoiceOver session', width: 1280, height: 800,
    webPreferences: { ...WEB_PREFERENCES, preload: join(desktop, 'dist/preload/index.cjs') } });
  applyWindowHardening(window.webContents, pathToFileURL(join(desktop, 'dist/renderer/index.html')).href, { openExternal: async () => {} });
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Validation fixture', submenu: [
      { label: 'Name save: normal', type: 'radio', checked: true, click: () => { nameOutcome = 'normal'; } },
      { label: 'Name save: refused', type: 'radio', click: () => { nameOutcome = 'blocked'; } },
      { label: 'Name save: unknown', type: 'radio', click: () => { nameOutcome = 'unknown'; } },
      { type: 'separator' },
      { label: 'Refuse next Escape skip', click: () => { refuseSkip = true; } },
      { label: 'Reopen setup', click: async () => { await dispatch('app.onboarding.restart', { commandId: globalThis.crypto.randomUUID() }); window?.reload(); } },
      { label: 'Zoom 100%', click: () => window?.webContents.setZoomFactor(1) },
      { label: 'Zoom 200%', click: () => window?.webContents.setZoomFactor(2) },
      { label: 'Viewport 1280 × 800', click: () => window?.setContentSize(1280, 800) },
      { label: 'Viewport 1920 × 1080', click: () => window?.setContentSize(1920, 1080) },
      { role: 'close' },
    ] },
  ]));
  await window.loadFile(join(desktop, 'dist/renderer/index.html'), { hash: '/overview' });
  console.log(JSON.stringify({ state: 'human_session_ready', profileKind: 'disposable', simulated: true,
    VoiceOver: 'not_certified', scheduler: 'disabled', network: '503_only', secrets: 'memory_only' }));
  window.on('closed', () => app.quit());
  if (smokeCheck) {
    let mounted = false;
    for (let i = 0; i < 100 && !mounted; i++) {
      mounted = await window.webContents.executeJavaScript("document.querySelector('.onboarding-dialog:modal')!==null");
      if (!mounted) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!mounted) throw new Error('native_dialog_missing');
    const refused = await window.webContents.executeJavaScript("window.coqui.query('app.evidence-export',{commandId:crypto.randomUUID()})");
    if (refused.status !== 'blocked' || refused.issues[0]?.code !== 'accessibility_fixture_scope') throw new Error('fixture_write_not_blocked');
    const about = await window.webContents.executeJavaScript("window.coqui.query('app.about',{})");
    if (about.status !== 'ok' || about.value.schemaVersion !== 93 || about.value.liveExecutionEnabled !== false) throw new Error('fixture_identity_invalid');
    console.log(JSON.stringify({ fixtureLaunchChecks: 3, passed: true, VoiceOver: 'not_tested' }));
    window.close(); return;
  }
  // Bound abandoned sessions. Closing earlier also disposes and removes only generated data.
  setTimeout(() => app.quit(), 30 * 60_000).unref();
}).catch(error => { console.error('VoiceOver fixture failed:', error.message); cleanup(); app.exit(1); });
