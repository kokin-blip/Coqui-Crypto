import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compareWiderUniverse, evaluateUniverseAsset, mapUniverseProducts, universeHash,
  WIDER_UNIVERSE_POLICY } from '../packages/core/dist/index.js';
import { listUniverseRecords, loadUniverseResearchFrames } from '../packages/storage/dist/index.js';
import { widerUniverseRuntimeSourceHash } from '../apps/desktop/dist/main/wider-universe-runtime.js';

const option = (name) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const databasePath = option('database'), profileId = option('profile') ?? 'main';
const phase = option('phase') ?? 'development';
if (!databasePath || !['development', 'holdout'].includes(phase)) {
  process.stderr.write('Usage: node scripts/research-wider-universe.mjs --database=/path/to/coqui.db [--profile=main] [--phase=development|holdout]\n');
  process.exitCode = 2;
} else {
  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name='wider_universe_records_v1'").get();
    const read = (kind, before) => tables ? listUniverseRecords(profileId, kind, db, before) : [];
    const nowMs = Date.now(), studies = read('study');
    const policyHash = option('policy-hash') ?? universeHash(WIDER_UNIVERSE_POLICY);
    const study = studies.find((r) => r.key === policyHash)?.body;
    const cutoff = phase === 'development' && study ? study.holdoutStartMs : phase === 'holdout' && study && nowMs < study.endExclusiveMs ? 0 : nowMs + 1;
    const frames = read('frame', cutoff);
    const verifiedFrames = tables ? loadUniverseResearchFrames(profileId, db, cutoff) : [];
    const catalogs = read('catalog', cutoff);
    const latest = catalogs.at(-1);
    const latestFrame = frames.at(-1)?.body;
    const decisions = latestFrame?.observations.map((o) => evaluateUniverseAsset(o.evidence, o.atMs, study?.policy ?? WIDER_UNIVERSE_POLICY)) ?? [];
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .split('\0').filter((p) => /^(packages|apps|scripts)\/.*\.(ts|tsx|js|mjs)$|^(package.json|pnpm-lock.yaml|tsconfig.*\.json)$/u.test(p));
    const sourceContentHash = universeHash([...new Set(files)].sort().map((p) => [p, readFileSync(p, 'utf8')]));
    const runtimeSourceHash = widerUniverseRuntimeSourceHash();
    const material = { schemaVersion: 1, generatedAtMs: nowMs, sourceContentHash, runtimeSourceHash,
      gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirtyTree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).length > 0,
      policyHash, study: study ?? null, phase,
      coverage: { catalogDays: catalogs.length, completeFrames: frames.length,
        observationRecords: read('observation', cutoff).length, shadowRecords: read('shadow', cutoff).length,
        failures: read('failure', cutoff).map((r) => ({ atMs: r.atMs, body: r.body })) },
      currentCatalog: latest ? { hash: latest.hash, observedAtMs: latest.atMs,
        products: mapUniverseProducts(latest.body.products, latest.body.assets).map((m) => ({
          assetId: m.mapping?.assetId ?? `${m.product.instrument.venue}|spot|${m.product.instrument.productId}`,
          mapping: m.mapping, reason: m.reason ?? 'requires_asof_eligibility_evaluation' })) } : null,
      lastFrameDecisions: decisions,
      comparison: study ? compareWiderUniverse(study, verifiedFrames, phase, nowMs, runtimeSourceHash)
        : { status: 'not_registered', results: null },
      functionalReadiness: 'automated_checks_do_not_attest_connected_account', historicalQualification: 'not_promoted',
      executionEnabled: false, limitations: ['Historical candles do not establish historical product eligibility.',
        'Coinbase depth is not Alpaca liquidity; recorded depth does not establish actual paper fills.',
        'Unknown evidence invalidates comparisons. No new-asset orders are authorized by this report.'] };
    process.stdout.write(`${JSON.stringify({ ...material, reportHash: universeHash(material) }, null, 2)}\n`);
  } catch {
    process.stderr.write('Wider-universe report failed; no credentials or provider payloads were printed.\n');
    process.exitCode = 1;
  } finally { db?.close(); }
}
