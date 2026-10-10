import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createMemorySecretStore } from '@coqui/adapters';
import { newsEvidenceHash } from '@coqui/core';
import { appendIntegrityEvent, associateNewsReport, createFileProfileBackupStore, createFileWalletNicknameStore,
  listIntegrityEvents, openDatabase, readProfileDeletionImpact, readVerifiedNewsReport, verifyIsolatedRestore } from '@coqui/storage';
import { createRuntimeProfileController } from '../dist/main/profile-runtime.js';
import { createDispatcher } from '../dist/main/dispatch.js';

// Generated sample only. No caller-supplied profile/backup/credential path exists.
const script = fileURLToPath(import.meta.url), desktop = dirname(dirname(script)), repository = dirname(dirname(desktop));
const { values } = parseArgs({ args: process.argv.slice(2), options: { phase: { type: 'string' }, root: { type: 'string' } } });
if (Boolean(values.phase) !== Boolean(values.root)) throw new Error('internal_phase_scope_required');
const root = values.phase ? realpathSync(values.root) : mkdtempSync(join(tmpdir(), 'coqui-restore-restart-'));
if (!/^coqui-restore-restart-[^/\\]+$/u.test(relative(realpathSync(tmpdir()), realpathSync(root)))) throw new Error('fixture_scope_required');
const marker = join(root, 'generated-fixture-only.json');
if (!values.phase) writeFileSync(marker, '{"version":1,"generatedFixtureOnly":true}', { flag: 'wx' });
if (JSON.parse(readFileSync(marker, 'utf8')).generatedFixtureOnly !== true) throw new Error('generated_fixture_required');
app.setPath('userData', root); app.setPath('sessionData', root);
globalThis.fetch = async () => new globalThis.Response('{}', { status: 503 });
globalThis.WebSocket = class { close() {} send() {} };
const fileHash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const checks = [];
function check(name, passed) { checks.push({ name, passed }); if (!passed) throw new Error(name); }
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const metadata = ['wallet-profiles.json', 'coqui-person.json', 'wallet-nicknames.json'];
function child(phase) {
  execFileSync(process.execPath, [script, '--phase', phase, '--root', root], { timeout: 45_000, stdio: 'pipe' });
  return readJson(join(root, phase + '.json'));
}
function fixtureReport() {
  const reports = [['daily', 24], ['hourly', 1], ['hourly', 4], ['hourly', 24]].map(([cadence, horizonHours]) => {
    const manifest = { fixture: true, codeRevision: 'a'.repeat(40), datasetHash: newsEvidenceHash([]), sourceManifestHashes: [],
      spec: { cadence, horizonHours, costHash: newsEvidenceHash({ fixture: true }) } };
    return { manifest, manifestHash: newsEvidenceHash(manifest), status: 'insufficient_evidence',
      reasons: ['no_eligible_prospective_news'], prospectiveRowCount: 0 };
  });
  const body = { version: 'news-study-report-v1', completedAtMs: 1, reports };
  return { ...body, reportHash: newsEvidenceHash(body) };
}
async function runtimePhase(phase) {
  const directory = join(root, phase === 'seed' ? 'source' : 'restored');
  mkdirSync(directory, { recursive: true });
  const controller = createRuntimeProfileController({ dataDirectory: directory, legacyDatabaseFilename: 'coqui.db',
    disableScheduler: true, runtime: { secrets: createMemorySecretStore() } });
  try {
    const dispatch = createDispatcher({ handlers: () => controller.handlers() });
    if (phase === 'seed') {
      check('synthetic person saved', (await dispatch('app.person.set', { commandId: randomUUID(), displayName: 'Restore fixture' })).status === 'ok');
      check('synthetic nickname saved', createFileWalletNicknameStore(join(directory, 'wallet-nicknames.json')).set('b'.repeat(64), 'Fixture wallet', null).ok);
      json(join(directory, 'report.json'), fixtureReport());
      const db = openDatabase(join(directory, 'coqui.db'));
      try {
        db.exec("INSERT INTO paper_ledger_entries_v3(id,profile_id,run_id,account,asset_id,amount_usd_text,quantity_text,at) VALUES ('restore-opening','main','restore-fixture','opening','USD','-1000.0000000000001','0',1),('restore-cash','main','restore-fixture','cash','USD','1000.0000000000001','1000.0000000000001',1)");
        appendIntegrityEvent({ namespace: 'restore-fixture', kind: 'negative_result', key: 'preserved', atMs: 1, body: { simulated: true } }, db);
        associateNewsReport({ profileId: 'main', path: join(directory, 'report.json'), atMs: 2 }, db);
      } finally { db.close(); }
    }
    const about = await dispatch('app.about', {}), person = await dispatch('app.person', {}), report = await dispatch('news.report', {});
    check('schema-compatible runtime read', about.status === 'ok' && about.value.schemaVersion === 93 && about.value.liveExecutionEnabled === false);
    check('person read succeeds', person.status === 'ok');
    check('report read succeeds', report.status === 'ok');
    json(join(root, phase + '.json'), { phase, profileId: controller.activeProfile().id, schema: about.value.schemaVersion,
      person: person.value, reportAssociation: report.value.association, reportHash: report.value.report?.reportHash ?? null,
      nickname: createFileWalletNicknameStore(join(directory, 'wallet-nicknames.json')).read(), checks,
      network: '503_only', scheduler: 'disabled', secrets: 'memory_only', processId: process.pid });
  } finally { controller.dispose(); }
}
async function run() {
  if (values.phase) {
    if (!['seed', 'missing-artifact', 'restart-1', 'restart-2'].includes(values.phase)) throw new Error('phase_invalid');
    await runtimePhase(values.phase); return;
  }
  const startedAtMs = Date.now();
  try {
    const seed = child('seed'), source = join(root, 'source'), backups = join(root, 'backups');
    const sourceHashes = Object.fromEntries(['coqui.db', ...metadata, 'report.json'].map(name => [name, fileHash(join(source, name))]));
    const db = openDatabase(join(source, 'coqui.db'));
    const impact = readProfileDeletionImpact('main', db); db.close();
    const store = createFileProfileBackupStore(source, backups);
    const created = await store.create({ backupId: randomUUID(), profileId: 'main', profileName: 'Generated recovery sample',
      dbFilename: 'coqui.db', createdAtMs: Date.now(), sourceManifestRevision: sourceHashes['wallet-profiles.json'], impact, credentialKinds: [] });
    check('existing backup store creates verified snapshot', created.ok);
    const verified = await store.verify(created.backup.artifactName, 'main'); check('backup manifest verified', verified.ok);
    const backup = join(backups, created.backup.artifactName), backupHashes = { database: fileHash(join(backup, 'profile.db')), manifest: fileHash(join(backup, 'manifest.json')) };
    const restored = join(root, 'restored');
    const proof = verifyIsolatedRestore({ sourceDatabase: join(backup, 'profile.db'), destination: restored, disposableRoot: root,
      expectedDatabaseHash: created.backup.databaseSha256, schemaVersion: 93, buildIdentity: readJson(join(desktop, 'dist/main/build-info.json')).sourceHash,
      artifacts: [...metadata, 'report.json'].map(name => ({ path: join(source, name), hash: sourceHashes[name] })) });
    check('exact ledger and immutable evidence validated', proof.ledgerTotalUsd === '0' && proof.ledgerRows >= 2 && proof.integrityEventKinds >= 1);
    renameSync(join(restored, 'profile.db'), join(restored, 'coqui.db'));
    for (const name of [...metadata, 'report.json']) copyFileSync(join(source, name), join(restored, name));
    check('copied metadata and report match supplied hashes', [...metadata, 'report.json'].every(name => fileHash(join(restored, name)) === sourceHashes[name]));
    const reportHash = readVerifiedNewsReport(join(restored, 'report.json')).reportHash;
    renameSync(source, join(root, 'source-quarantined'));
    const missing = child('missing-artifact');
    check('unresolved original absolute report path stays unavailable', missing.reportAssociation === 'unavailable');
    // Probe the existing API on generated data only; never rewrite its immutable original association.
    const restoredDb = openDatabase(join(restored, 'coqui.db'));
    try { associateNewsReport({ profileId: 'main', path: join(restored, 'report.json'), atMs: Date.now() }, restoredDb); } finally { restoredDb.close(); }
    const first = child('restart-1'), second = child('restart-2');
    check('two separate process reconstructions succeed', first.processId !== second.processId && first.processId !== seed.processId);
    check('relocation remains unavailable across two restarts', [first, second].every(p => p.reportAssociation === 'unavailable' && p.reportHash === null));
    check('person and nickname survive reconstruction', JSON.stringify(first.person) === JSON.stringify(seed.person) && JSON.stringify(second.nickname) === JSON.stringify(seed.nickname));
    const finalDb = openDatabase(join(restored, 'coqui.db'));
    let associationCount;
    try {
      associationCount = finalDb.prepare('SELECT count(*) AS n FROM news_report_associations_v1').get().n;
      check('same-hash reassociation is a no-op; original and negative evidence preserved', associationCount === 1 && listIntegrityEvents('restore-fixture', 'negative_result', finalDb).length === 1);
      check('no orders created by reconstruction', finalDb.prepare('SELECT count(*) AS n FROM paper_orders_v3').get().n === 0);
      check('schema unchanged on reconstruction', finalDb.prepare('PRAGMA user_version').get().user_version === 93);
    } finally { finalDb.close(); }
    check('source and backup preserved', Object.entries(sourceHashes).every(([name, hash]) => fileHash(join(root, 'source-quarantined', name)) === hash) &&
      fileHash(join(backup, 'profile.db')) === backupHashes.database && fileHash(join(backup, 'manifest.json')) === backupHashes.manifest);
    const corruptRoot = join(root, 'corrupt-backup'); mkdirSync(corruptRoot);
    cpSync(backup, join(corruptRoot, created.backup.artifactName), { recursive: true });
    writeFileSync(join(corruptRoot, created.backup.artifactName, 'manifest.json'), '{}');
    check('corrupt manifest refused', !(await createFileProfileBackupStore(join(root, 'source-quarantined'), corruptRoot).verify(created.backup.artifactName)).ok);
    const workload = { version: 1, generatedProfile: true, metadata, externalReport: 'synthetic_insufficient_four_horizons',
      ledger: 'exact_balanced_decimal', originalIsolation: 'quarantined_source', reconstructions: 3, existingAssociationRelocationProbe: true };
    const body = { version: 'restore-restart-evidence-v1', simulated: true, profileKind: 'generated_disposable', startedAtMs, completedAtMs: Date.now(),
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
      build: readJson(join(desktop, 'dist/main/build-info.json')), environment: { platform: process.platform, electron: process.versions.electron, node: process.versions.node },
      workload, workloadHash: newsEvidenceHash(workload), schemaVersion: 93, backupHashes, reportHash, originalAssociationPreserved: associationCount === 1,
      checks, sampleProof: proof, credentialsIncluded: false, actualProfileOpened: false, network: '503_only', scheduler: 'disabled',
      gatesClosed: [], exclusions: ['actual-profile certification', 'multi-profile restore', 'actual archive/publisher content', 'broker/provider operation',
        'automatic relocation of absolute report references', 'installed distributable', 'VoiceOver'],
      observedLimit: 'Copied reports do not repair stored absolute paths. The existing association API silently ignores relocation for the same report/profile primary key. An explicit append-only relocation design is still required.' };
    const output = join(repository, 'docs/implementation/evidence/restore-restart'); mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'checks.json'), JSON.stringify({ ...body, evidenceHash: newsEvidenceHash(body) }, null, 2) + '\n');
    console.log(JSON.stringify({ passed: checks.length, simulated: true, actualProfileCertified: false, reportRelocation: 'blocked_existing_primary_key' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
app.whenReady().then(run).then(() => app.exit(0)).catch(error => { console.error('Disposable restore exercise failed:', error.message); app.exit(1); });
