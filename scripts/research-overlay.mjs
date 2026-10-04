import { overlayCandidates } from '../packages/core/dist/index.js';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dependencyManifest } from './build-study-manifests.mjs';
import { registerOverlayStudy, requireOverlayStudy, runOverlayDevelopment,
  freezeOverlayStudy, runOverlayFinal, importOverlayShadowBinding, exportOverlayShadowBinding } from '../packages/services/dist/index.js';
import { openDatabase, prepareDecisionDatasetFromArchives } from '../packages/storage/dist/index.js';
const HELP = `Usage: pnpm research:overlay -- <identity|register|development|freeze|final|shadow-export|shadow-import> [options]
  --database=<isolated research database> --plan=<registration JSON> --plan-hash=<hash>
  --archives=<comma-separated archive directories>
  --output-root=<prepared dataset directory> --liquidity=<versioned USD observations JSON>
  shadow-export: --scenario=<conservative|account> --daily=<candidate hash|baseline> --fourteen=<candidate hash|baseline>
  shadow-import: --binding=<binding and contentHash JSON> --profile=<profile id>
Final evaluation claims the holdout before reading archives. No command activates paper trading.`;
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const command = process.argv[2];
const liquidity = () => option('liquidity') ? JSON.parse(readFileSync(resolve(option('liquidity')), 'utf8')) : [];
if (!command || process.argv.includes('--help')) { console.log(HELP); process.exit(0); }
const runtime = {
  codeRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceManifestHash: dependencyManifest(resolve('.'), 'packages/services/src/research/overlay-study.ts').hash,
  lockfileHash: createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),
};
if (command === 'identity') { console.log(JSON.stringify(runtime, null, 2)); process.exit(0); }
if (!option('database')) throw new Error('An explicit research database is required');
const db = openDatabase(resolve(option('database')));
try {
  if (command === 'shadow-import') {
    const { binding, contentHash } = JSON.parse(readFileSync(resolve(option('binding') ?? ''), 'utf8'));
    if (!option('profile')) throw new Error('An explicit profile id is required');
    importOverlayShadowBinding(option('profile'), binding, contentHash, Date.now(), db);
    console.log(JSON.stringify({ imported: true, qualified: false }));
  } else if (command === 'register') {
    const plan = JSON.parse(readFileSync(resolve(option('plan') ?? ''), 'utf8'));
    if (Object.entries(runtime).some(([key, value]) => plan[key] !== value)) throw new Error('Registration runtime mismatch');
    console.log(JSON.stringify({ planHash: registerOverlayStudy(plan, db) }));
  } else {
    const hash = option('plan-hash') ?? '', plan = requireOverlayStudy(hash, db);
    const prepare = async (final) => {
      const dirs = (option('archives') ?? '').split(',').filter(Boolean);
      if (!dirs.length || !option('output-root')) throw new Error('Archives and an explicit output root are required');
      if (!final && dirs.some((dir) => JSON.parse(readFileSync(join(resolve(dir), 'manifest.json'), 'utf8')).lastStartTimeMs >= plan.validation.development.endExclusiveMs)) {
        throw new Error('Development requires physically separate archives without holdout observations');
      }
      const instruments = plan.execution.baseTargets.map(({ assetId }) => {
        const [venue, productType, productId] = assetId.split('|');
        return { venue, productType, productId };
      });
      const prepared = await prepareDecisionDatasetFromArchives({ rootDir: resolve(option('output-root')),
        sourceDatasetDirs: dirs.map((dir) => resolve(dir)), instruments,
        startTimeMs: plan.validation.development.startMs,
        endExclusiveMs: final ? plan.validation.holdout.endExclusiveMs : plan.validation.development.endExclusiveMs,
        codeRevision: runtime.codeRevision });
      return prepared.dataset;
    };
    if (command === 'shadow-export') {
      const ids = [1, 14].map((cadence) => { const value = option(cadence === 1 ? 'daily' : 'fourteen');
        if (!value) throw new Error('Explicit daily and fourteen choices are required');
        return value === 'baseline' ? overlayCandidates().find((c) => c.cadence === cadence && c.model === 'none' && c.gate === 'none').id : value; });
      console.log(JSON.stringify(exportOverlayShadowBinding(hash, option('scenario') ?? 'conservative', ids, db), null, 2));
    } else if (command === 'development') console.log(JSON.stringify(runOverlayDevelopment(hash, await prepare(false), runtime, Date.now(), db, liquidity()), null, 2));
    else if (command === 'freeze') {
      console.log(JSON.stringify(freezeOverlayStudy(hash, await prepare(false), Date.now(), db, liquidity()), null, 2));
    } else if (command === 'final') console.log(JSON.stringify(await runOverlayFinal(hash, runtime, Date.now(), async () => ({ dataset: await prepare(true), liquidity: liquidity() }), db), null, 2));
    else throw new Error('Unknown research integrity command');
  }
} finally { db.close(); }
