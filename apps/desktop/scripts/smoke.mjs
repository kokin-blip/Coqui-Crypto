import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { setTimeout } from 'node:timers';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stage 2.4 smoke gate.
 *
 * Proves the boundary end to end in a real Electron process: the composition
 * root builds, `node:sqlite` opens a migrated profile database, the dispatcher
 * validates a request, a real service answers it, the response is validated
 * against the contract, and the whole thing arrives in the renderer through the
 * sandboxed preload's `contextBridge`.
 *
 * Everything under test is the production module — `composition.js`,
 * `dispatch.js`, `security.js` and the bundled preload — so passing here means
 * those files work, not that a parallel harness does.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// `tsc -b` skips emitting when its .tsbuildinfo looks current, so a dist that
// was deleted by hand comes back empty and the failure would otherwise surface
// as an opaque module-resolution error after Electron has already booted.
for (const artifact of ['dist/main/composition.js', 'dist/preload/index.cjs', 'dist/renderer/index.html']) {
  if (!existsSync(join(root, artifact))) {
    console.error(`[coqui] missing ${artifact} — run "pnpm --filter @coqui/desktop build --force".`);
    process.exit(1);
  }
}

const { createRuntime } = await import(join(root, 'dist/main/composition.js'));
const { createDispatcher } = await import(join(root, 'dist/main/dispatch.js'));
const { applyWindowHardening, WEB_PREFERENCES, CONTENT_SECURITY_POLICY } = await import(
  join(root, 'dist/main/security.js')
);

const checks = [];
function check(name, passed, detail = '') {
  checks.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

/**
 * A hung renderer must fail the gate, not stall it. Without this a blocked
 * `executeJavaScript` would burn the whole CI job timeout and report nothing
 * about which step it reached.
 */
const WATCHDOG_MS = 60_000;
function withTimeout(label, promise) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${WATCHDOG_MS}ms: ${label}`)), WATCHDOG_MS),
    ),
  ]);
}

const dataDir = mkdtempSync(join(tmpdir(), 'coqui-smoke-'));
let runtime = null;

async function run() {
  runtime = createRuntime({
    databasePath: join(dataDir, 'coqui.db'),
    profileId: 'main',
    // The smoke gate proves wiring, not cadence. A live scheduler would start a
    // timer and reach the network to refresh bars, neither of which this
    // measures.
    disableScheduler: true,
  });
  check('composition root builds', runtime.handlers !== undefined);

  const version = runtime.database.prepare('PRAGMA user_version').get();
  check('profile database migrated', Number(version?.user_version) > 0, `user_version=${Number(version?.user_version)}`);

  const dispatch = createDispatcher({ handlers: runtime.handlers });
  ipcMain.handle('coqui:query', async (_event, channel, payload) => dispatch(channel, payload));

  const entry = join(root, 'dist/renderer/index.html');
  const origin = `file://${entry}`;
  const window = new BrowserWindow({
    show: false,
    webPreferences: { ...WEB_PREFERENCES, preload: join(root, 'dist/preload/index.cjs') },
  });

  const installed = applyWindowHardening(window.webContents, origin, shell);
  check('window hardening installed', installed === 5, `${installed} controls`);
  check('sandbox enabled', WEB_PREFERENCES.sandbox === true);
  check('csp denies connect-src', CONTENT_SECURITY_POLICY.includes("connect-src 'none'"));

  await withTimeout('loadFile', window.loadFile(entry));
  check('renderer loaded', true);

  // The React tree must actually mount under the CSP. A blank root would mean
  // the bundle was blocked, which is the failure this gate exists to catch.
  const mounted = await withTimeout(
    'mount probe',
    window.webContents.executeJavaScript('document.getElementById("root").children.length > 0'),
  );
  check('react tree mounted under CSP', mounted === true);

  // The bridge must exist in the renderer's main world, and nothing else.
  const bridge = await withTimeout('bridge probe', window.webContents.executeJavaScript(
    'JSON.stringify({ hasCoqui: typeof window.coqui === "object", ' +
      'hasQuery: typeof window.coqui?.query === "function", ' +
      'hasRequire: typeof window.require !== "undefined", ' +
      'hasProcess: typeof window.process !== "undefined" })',
  ));
  const bridgeState = JSON.parse(bridge);
  check('contextBridge exposes coqui.query', bridgeState.hasCoqui && bridgeState.hasQuery);
  check('renderer has no node require', bridgeState.hasRequire === false);
  check('renderer has no node process', bridgeState.hasProcess === false);

  // A real round trip: renderer -> preload validation -> ipcMain -> dispatcher
  // -> ResearchReadModelService -> response validation -> renderer.
  const runs = JSON.parse(
    await withTimeout('research.runs', window.webContents.executeJavaScript(
      'window.coqui.query("research.runs", {}).then(JSON.stringify)',
    )),
  );
  check(
    'research.runs round-trips',
    runs.status === 'ok' && Array.isArray(runs.value),
    `status=${runs.status}`,
  );

  // An unregistered channel is refused at the preload, before any IPC.
  const unknown = JSON.parse(
    await withTimeout('unknown channel', window.webContents.executeJavaScript(
      'window.coqui.query("market-data.everything", {}).then(JSON.stringify)',
    )),
  );
  check(
    'unknown channel refused',
    unknown.status === 'failed' && unknown.issues[0].code === 'unknown_channel',
    `code=${unknown.issues?.[0]?.code}`,
  );

  // An out-of-range payload is refused before a service runs.
  const badPayload = JSON.parse(
    await withTimeout('invalid payload', window.webContents.executeJavaScript(
      'window.coqui.query("research.jobs", { limit: 9999 }).then(JSON.stringify)',
    )),
  );
  check(
    'invalid payload refused',
    badPayload.status === 'failed' && badPayload.issues[0].code === 'invalid_request_payload',
    `code=${badPayload.issues?.[0]?.code}`,
  );

  // A well-formed request reaching a real service through the whole chain.
  const jobs = JSON.parse(
    await withTimeout('research.jobs', window.webContents.executeJavaScript(
      'window.coqui.query("research.jobs", { limit: 5 }).then(JSON.stringify)',
    )),
  );
  check('research.jobs round-trips', jobs.status === 'ok', `status=${jobs.status}`);

  // The scoreboard's channel, end to end. liveExecutionPermitted is pinned to
  // false by the wire type, so a main process that sent true would fail
  // response validation rather than reach the screen.
  const gate = JSON.parse(
    await withTimeout('risk.evidence-gate', window.webContents.executeJavaScript(
      'window.coqui.query("risk.evidence-gate", {}).then(JSON.stringify)',
    )),
  );
  check(
    'risk.evidence-gate round-trips',
    gate.status === 'ok' && gate.value.liveExecutionPermitted === false,
    `status=${gate.status}, gateStatus=${gate.value?.status}`,
  );

  // A fresh profile has no study run, so the honest outcome is a named
  // 'no_verified_run' failure — not an empty table pretending to be a result.
  const board = JSON.parse(
    await withTimeout('research.scoreboard', window.webContents.executeJavaScript(
      'window.coqui.query("research.scoreboard", {}).then(JSON.stringify)',
    )),
  );
  check(
    'research.scoreboard reports no run distinctly',
    board.status === 'failed' && board.issues[0].code === 'no_verified_run',
    `status=${board.status}, code=${board.issues?.[0]?.code}`,
  );

  const findings = JSON.parse(
    await withTimeout('research.negative-findings', window.webContents.executeJavaScript(
      'window.coqui.query("research.negative-findings", {}).then(JSON.stringify)',
    )),
  );
  check(
    'research.negative-findings round-trips',
    findings.status === 'ok' && findings.value.findings.length > 0,
    `count=${findings.value?.findings?.length}`,
  );

  // Exercises the real price source composition, which reaches the network —
  // an empty profile prices nothing, so this asserts the shape, not a quote.
  const portfolio = JSON.parse(
    await withTimeout('portfolio.view', window.webContents.executeJavaScript(
      'window.coqui.query("portfolio.view", {}).then(JSON.stringify)',
    )),
  );
  check(
    'portfolio.view round-trips',
    portfolio.status === 'ok' && Array.isArray(portfolio.value.holdings),
    `status=${portfolio.status}, holdings=${portfolio.value?.holdings?.length}`,
  );

  const reconciliation = JSON.parse(
    await withTimeout('portfolio.reconciliation', window.webContents.executeJavaScript(
      'window.coqui.query("portfolio.reconciliation", { profileId: "main" }).then(JSON.stringify)',
    )),
  );
  check(
    'portfolio.reconciliation round-trips',
    reconciliation.status === 'ok' && Array.isArray(reconciliation.value.discrepancies),
    `status=${reconciliation.status}`,
  );

  // The first write channel. A fresh profile has no evidence, so the correct
  // answer is a refusal — which proves the command path reaches the service and
  // that a resolution cannot be recorded against nothing.
  const resolve = JSON.parse(
    await withTimeout('portfolio.reconciliation.resolve', window.webContents.executeJavaScript(
      `window.coqui.query("portfolio.reconciliation.resolve", {
        profileId: "main",
        discrepancyId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        kind: "provider_error",
        linkedLotId: null,
        note: "smoke"
      }).then(JSON.stringify)`,
    )),
  );
  check(
    'reconciliation write refuses unbacked evidence',
    resolve.status === 'failed' && resolve.issues?.[0]?.code === 'unknown_discrepancy',
    `status=${resolve.status}, code=${resolve.issues?.[0]?.code}`,
  );

  for (const [channel, payload, describe] of [
    ['portfolio.allocation', '{}', (v) => `estimateOnly=${v?.plan?.estimateOnly}`],
    ['portfolio.tax', '{}', (v) => `disposals=${v?.disposals?.length}`],
    ['accounts.settings', '{ profileId: "main" }', (v) => `density=${v?.preferences?.density}`],
    // The literal marker matters more than the number: a paper figure that
    // crossed IPC without it could be rendered as money.
    ['paper.portfolio', '{ profileId: "main" }', (v) => `simulation=${v?.simulation}`],
  ]) {
    const outcome = JSON.parse(
      await withTimeout(channel, window.webContents.executeJavaScript(
        `window.coqui.query("${channel}", ${payload}).then(JSON.stringify)`,
      )),
    );
    check(
      `${channel} round-trips`,
      outcome.status === 'ok',
      `status=${outcome.status}, ${describe(outcome.value)}${outcome.issues ? " codes=" + outcome.issues.map((i) => i.code).join("/") : ""}`,
    );
  }

  // The rail is reused by every screen, so a failure here breaks all of them.
  const railOutcome = JSON.parse(
    await withTimeout('app.status-rail', window.webContents.executeJavaScript(
      'window.coqui.query("app.status-rail", { profileId: "main" }).then(JSON.stringify)',
    )),
  );
  check(
    'app.status-rail round-trips',
    railOutcome.status === 'ok' && railOutcome.value.mode === 'paper',
    `status=${railOutcome.status}, mode=${railOutcome.value?.mode}`,
  );

  window.destroy();
}

app.enableSandbox();

app.whenReady().then(async () => {
  let fatal = null;
  try {
    await run();
  } catch (error) {
    fatal = error;
  }

  console.log('\n=== STAGE 2.4 SMOKE GATE ===');
  if (fatal) console.log(`FAIL  threw: ${fatal?.stack ?? fatal}`);

  const failures = checks.filter((entry) => !entry.passed).length + (fatal ? 1 : 0);
  console.log(`=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} ===`);

  try {
    runtime?.dispose();
  } catch {
    // Disposal noise must not mask the result above.
  }
  rmSync(dataDir, { recursive: true, force: true });
  app.exit(failures === 0 ? 0 : 1);
});
