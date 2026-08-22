import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

/**
 * Stage 3.6 performance harness.
 *
 * `docs/UI-UX.md` §5 sets the budgets and §7.4 requires that a deliberate
 * renderer-blocking regression *fails* this harness. That second requirement is
 * the important one: a performance test that only ever passes proves nothing
 * about its own sensitivity, so the harness measures a known-bad build as a
 * control and fails if that control comes out clean.
 *
 * Measured against a production build, never a dev server.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const BUDGETS = {
  /** Warm useful shell: launch to the first channel response rendered. */
  warmShellMs: 1_500,
  /** p75 of round trips through the real IPC boundary. */
  p75InteractionMs: 200,
};

/** Interactions sampled per run. p75 needs enough samples to mean something. */
const SAMPLES = 40;

/**
 * Latency is measured from interaction start to the next painted frame. The
 * IPC promise alone resolves in well under a millisecond, which measures the
 * transport rather than what a user perceives — and would let a renderer that
 * cannot paint still report a passing number.
 */

for (const artifact of ['dist/main/composition.js', 'dist/renderer/index.html']) {
  if (!existsSync(join(root, artifact))) {
    console.error(`[coqui] missing ${artifact} — run "pnpm --filter @coqui/desktop build".`);
    process.exit(1);
  }
}

const { createRuntime } = await import(join(root, 'dist/main/composition.js'));
const { createDispatcher } = await import(join(root, 'dist/main/dispatch.js'));
const { applyWindowHardening, WEB_PREFERENCES } = await import(join(root, 'dist/main/security.js'));

const WATCHDOG_MS = 90_000;
function withTimeout(label, promise) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out: ${label}`)), WATCHDOG_MS),
    ),
  ]);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/**
 * Run one measurement pass.
 *
 * `blockRendererMs` injects a synthetic long task on the renderer's main thread
 * before each interaction. It is the control: with a large enough value the p75
 * budget must be exceeded, and if it is not, the harness is not measuring what
 * it claims to.
 */
async function measure({ blockRendererMs = 0 } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'coqui-perf-'));
  const runtime = createRuntime({
    databasePath: join(dataDir, 'coqui.db'),
    profileId: 'main',
    // Background ticks would contaminate an interaction-latency measurement.
    disableScheduler: true,
  });
  const dispatch = createDispatcher({ handlers: runtime.handlers });

  // The preload invokes a fixed channel name, so the handler is replaced
  // rather than registered under a per-pass name.
  ipcMain.removeHandler('coqui:query');
  ipcMain.handle('coqui:query', async (_event, name, payload) => dispatch(name, payload));

  const startedAt = Date.now();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { ...WEB_PREFERENCES, preload: join(root, 'dist/preload/index.cjs') },
  });
  const entry = join(root, 'dist/renderer/index.html');
  applyWindowHardening(window.webContents, `file://${entry}`, shell);

  // loadFile's promise rejects with an abort on paths where the load actually
  // succeeded, so completion is taken from the event instead.
  const loaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  window.loadFile(entry).catch(() => {});
  await withTimeout('load', loaded);
  await withTimeout(
    'mount',
    window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => {
          if (document.getElementById('root')?.children.length > 0) resolve(true);
          else requestAnimationFrame(check);
        };
        check();
      })
    `),
  );
  const warmShellMs = Date.now() - startedAt;

  const samples = JSON.parse(
    await withTimeout(
      'interactions',
      window.webContents.executeJavaScript(`
        (async () => {
          const durations = [];
          const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
          for (let i = 0; i < ${SAMPLES}; i += 1) {
            const started = performance.now();
            ${blockRendererMs > 0
              ? `setTimeout(() => {
                   const until = performance.now() + ${blockRendererMs};
                   while (performance.now() < until) { /* synthetic long task */ }
                 }, 0);`
              : ''}
            await window.coqui.query('research.jobs', { limit: 20 });
            // Latency is measured to the next painted frame, not to the resolved
            // promise. UI-UX §5 budgets what the user perceives, and a response
            // that cannot paint because the main thread is busy is not fast.
            await nextFrame();
            durations.push(performance.now() - started);
          }
          return JSON.stringify(durations);
        })()
      `),
    ),
  );

  window.destroy();
  runtime.dispose();
  rmSync(dataDir, { recursive: true, force: true });

  return {
    warmShellMs,
    p50: percentile(samples, 0.5),
    p75: percentile(samples, 0.75),
    p95: percentile(samples, 0.95),
  };
}

app.enableSandbox();

// Destroying the first pass's window would otherwise fire window-all-closed,
// whose default behaviour quits the app before the control pass can load.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const failures = [];
  let baseline;
  let control;

  try {
    baseline = await measure();
    control = await measure({ blockRendererMs: 250 });
  } catch (error) {
    console.error(`[coqui] perf harness failed: ${error?.stack ?? error}`);
    app.exit(1);
    return;
  }

  const line = (label, value, budget, unit = 'ms') =>
    `${label.padEnd(26)} ${value.toFixed(1).padStart(8)}${unit}` +
    (budget === undefined ? '' : `   budget ${budget}${unit}  ${value <= budget ? 'ok' : 'OVER'}`);

  console.log('\n=== PERFORMANCE HARNESS ===');
  console.log(`reference machine  ${process.platform}/${process.arch}  electron ${process.versions.electron}`);
  console.log('\nbaseline (production build)');
  console.log(line('warm useful shell', baseline.warmShellMs, BUDGETS.warmShellMs));
  console.log(line('interaction p50', baseline.p50));
  console.log(line('interaction p75', baseline.p75, BUDGETS.p75InteractionMs));
  console.log(line('interaction p95', baseline.p95));

  if (baseline.warmShellMs > BUDGETS.warmShellMs) failures.push('warm shell over budget');
  if (baseline.p75 > BUDGETS.p75InteractionMs) failures.push('p75 interaction over budget');

  console.log('\ncontrol: 250ms synthetic long task before each interaction');
  console.log(line('interaction p75', control.p75, BUDGETS.p75InteractionMs));

  // A harness that cannot detect a deliberate regression is not a harness.
  if (control.p75 <= BUDGETS.p75InteractionMs) {
    failures.push('control did not breach the budget — the harness is not sensitive');
  } else {
    console.log('control breached the budget as required — harness is sensitive');
  }

  console.log(`\n=== ${failures.length === 0 ? 'ALL PASS' : failures.join('; ')} ===`);
  app.exit(failures.length === 0 ? 0 : 1);
});
