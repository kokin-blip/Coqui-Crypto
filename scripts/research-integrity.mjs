import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dependencyManifest } from './build-study-manifests.mjs';
import { registerIntegrityStudy, requireIntegrityStudy, runIntegrityDevelopment,
  freezeIntegrityCandidate, runIntegrityFinal } from '../packages/services/dist/index.js';
import { openDatabase, prepareDecisionDatasetFromArchives } from '../packages/storage/dist/index.js';
const HELP = `Usage: pnpm research:integrity -- <identity|register|development|freeze|final> [options]
  --database=<isolated research database> --plan=<registration JSON> --plan-hash=<hash>
  --archives=<comma-separated archive directories> --candidate=<selected hash|none>
  --output-root=<prepared dataset directory>
Final evaluation claims the holdout before reading archives. No command activates paper trading.`;
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const command = process.argv[2];
if (!command || process.argv.includes('--help')) { console.log(HELP); process.exit(0); }
const runtime = {
  codeRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceManifestHash: dependencyManifest(resolve('.'), 'packages/services/src/research/integrity-study.ts').hash,
  lockfileHash: createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),
};
if (command === 'identity') { console.log(JSON.stringify(runtime, null, 2)); process.exit(0); }
if (!option('database')) throw new Error('An explicit research database is required');
const db = openDatabase(resolve(option('database')));
try {
  if (command === 'register') {
    const plan = JSON.parse(readFileSync(resolve(option('plan') ?? ''), 'utf8'));
    if (Object.entries(runtime).some(([key, value]) => plan[key] !== value)) throw new Error('Registration runtime mismatch');
    console.log(JSON.stringify({ planHash: registerIntegrityStudy(plan, db) }));
  } else {
    const hash = option('plan-hash') ?? '', plan = requireIntegrityStudy(hash, db);
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
    if (command === 'development') console.log(JSON.stringify(runIntegrityDevelopment(hash, await prepare(false), runtime, Date.now(), db), null, 2));
    else if (command === 'freeze') {
      const candidate = option('candidate');
      if (!candidate) throw new Error('Freeze requires an explicit selected candidate or none');
      console.log(JSON.stringify({ freezeHash: freezeIntegrityCandidate(hash, candidate === 'none' ? null : candidate, Date.now(), db) }));
    } else if (command === 'final') console.log(JSON.stringify(await runIntegrityFinal(hash, runtime, Date.now(), () => prepare(true), db), null, 2));
    else throw new Error('Unknown research integrity command');
  }
} finally { db.close(); }
