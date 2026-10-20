// Isolated production-component render: synthetic data, no app IPC or provider calls.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout, clearTimeout } from 'node:timers';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const desktop = join(repository, 'apps/desktop');
const output = join(repository, 'docs/implementation/evidence/oct20/recovery-visual');
if (!process.versions.electron) {
  const requireDesktop = createRequire(join(desktop, 'package.json'));
  const { build } = requireDesktop('esbuild');
  const work = mkdtempSync(join(tmpdir(), 'coqui-recovery-visual-'));
  const bundle = join(work, 'render.cjs');
  const css = readdirSync(join(desktop, 'dist/renderer/assets')).filter(name => name.startsWith('index-') && name.endsWith('.css'))
    .map(name => `<link rel="stylesheet" href="${pathToFileURL(join(desktop, 'dist/renderer/assets', name)).href}">`).join('');
  await build({ stdin: { resolveDir: desktop, sourcefile: 'recovery-fixture.tsx', loader: 'tsx', contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { writeFileSync } from 'node:fs';
    import { ParallelPaperRecovery } from './src/renderer/app/ParallelPaperRecovery.tsx';
    const failure = { atMs: 1792517400000, operation: 'positions', reason: 'broker_positions_mismatch',
      httpStatus: null, attemptCount: null, remainingMs: null,
      feeReconciliation: {kind:'fee_shaped_limit_exceeded',observedValueUsd:'80.06',maxAbsoluteValueUsd:'25',maxEquityValueUsd:'51.45'},
      positionDifferences:[{symbol:'BTCUSD',expectedQty:'1',observedQty:'0.9975',differenceQty:'-0.0025'}] };
    const network = process.argv[2] === 'network';
    const data = {state:'paused',experimentId:'fixture',reconciliationAttention:{blocked:true,lastSuccessfulAtMs:null,
      unresolvedOrders:[],latestFailure:network ? {...failure,operation:'account',reason:'alpaca_unavailable',
        networkCode:'ENOTFOUND',elapsedMs:3.2,budgetMs:10000,remainingMs:9996.8,attemptCount:2,
        feeReconciliation:null,positionDifferences:[]} : failure}};
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>
      <main className="remaining-terminal-route" style={{maxWidth:1000,margin:'24px auto',padding:24}}>
        <h1>Paper recovery · synthetic fixture</h1><ParallelPaperRecovery client={{}} data={data}/>
      </main></QueryClientProvider>);
    writeFileSync(process.argv[3], '<!doctype html><html data-theme="dark" data-density="compact"><head><meta charset="utf-8">'
      + ${JSON.stringify(css)} + '</head><body>'+html+'</body></html>');
  ` }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, jsx: 'automatic' });
  for (const state of ['fee', 'network']) execFileSync(process.execPath, [bundle, state, join(work, `${state}.html`)]);
  console.log(JSON.stringify({ work, bundle, output }));
} else {
  const { app, BrowserWindow } = await import('electron');
  const { assertNoTextClipping } = await import(pathToFileURL(join(desktop, 'scripts/visual-overflow-audit.mjs')));
  const work = process.argv[2];
  if (!work) throw new Error('Pass the fixture directory emitted by the Node run');
  app.setPath('userData', join(work, 'electron-profile'));
  const watchdog = setTimeout(() => app.exit(1), 30000);
  app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true });
  const checks = [];
  const window = new BrowserWindow({ show: false, width: 1440, height: 1100,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  try {
    for (const state of ['fee', 'network']) for (const zoom of [1, 2]) {
      const name = `${state}-${zoom === 1 ? 'desktop' : 'zoom'}`;
      window.setSize(zoom === 1 ? 1440 : 1280, 1100);
      await window.loadFile(join(work, `${state}.html`));
      window.webContents.setZoomFactor(zoom);
      await window.webContents.executeJavaScript('document.fonts.ready');
      await assertNoTextClipping(window.webContents, name);
      writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
      checks.push({ name, noTextClipping: true });
    }
    writeFileSync(join(output, 'checks.json'), JSON.stringify(checks, null, 2));
    console.log(JSON.stringify(checks));
  } finally { window.destroy(); clearTimeout(watchdog); app.quit(); }
  }).catch(error => { console.error(error); app.exit(1); });
}
