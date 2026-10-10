import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute, dirname, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Decimal as DecimalBase } from 'decimal.js';
import { canonicalJson, sha256Hex } from '@coqui/core';
import { listIntegrityEvents } from '../repositories/research-integrity.js';

const Decimal = DecimalBase.clone({precision:40});
const fileHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** Never initializes application, migrates a database, loads secrets or overwrites a destination. */
export function verifyIsolatedRestore(input: { sourceDatabase: string; destination: string; disposableRoot: string;
  expectedDatabaseHash: string; schemaVersion: number; buildIdentity: string;
  artifacts: readonly { path: string; hash: string }[] }) {
  const root = realpathSync(input.disposableRoot), destination = join(realpathSync(dirname(input.destination)),basename(input.destination)), child = relative(root,destination);
  if (!child || child.startsWith('..') || isAbsolute(child) || !/^[a-f0-9]{64}$/u.test(input.expectedDatabaseHash) || !input.buildIdentity) throw new Error('restore_scope_invalid');
  if (fileHash(input.sourceDatabase) !== input.expectedDatabaseHash) throw new Error('backup_hash_mismatch');
  mkdirSync(destination); // Existing destination is refused, including a symlink.
  const databasePath = join(destination,'profile.db');
  copyFileSync(input.sourceDatabase,databasePath);
  const db = new DatabaseSync(databasePath,{ readOnly: true, allowExtension: false });
  try {
    const schema = db.prepare('PRAGMA user_version').get()?.['user_version'];
    if (schema !== input.schemaVersion || db.prepare('PRAGMA integrity_check').get()?.['integrity_check'] !== 'ok' ||
        db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('restore_database_invalid');
    const ledger = db.prepare('SELECT amount_usd_text FROM paper_ledger_entries_v3').all() as { amount_usd_text: string }[];
    const ledgerTotalUsd = ledger.reduce((total,row) => total.add(row.amount_usd_text),new Decimal(0));
    if (!ledgerTotalUsd.isZero()) throw new Error('restore_ledger_unbalanced');
    const kinds = db.prepare('SELECT DISTINCT kind FROM research_integrity_events').all() as { kind: string }[];
    for (const row of kinds) listIntegrityEvents(null,row.kind,db);
    const artifacts = input.artifacts.map(a => {
      if (!/^[a-f0-9]{64}$/u.test(a.hash) || !statSync(a.path).isFile() || statSync(a.path).size > 100_000_000 || fileHash(a.path) !== a.hash) throw new Error('restore_artifact_invalid');
      return { hash: a.hash }; // Proof does not expose local paths.
    });
    if (fileHash(databasePath) !== input.expectedDatabaseHash || fileHash(input.sourceDatabase) !== input.expectedDatabaseHash) throw new Error('restore_source_changed');
    const body = { version: 'isolated-restore-proof-v1', schemaVersion: schema, buildIdentity: input.buildIdentity,
      databaseHash: input.expectedDatabaseHash, ledgerTotalUsd: ledgerTotalUsd.toFixed(), ledgerRows: ledger.length,
      integrityEventKinds: kinds.length, artifacts, credentialsIncluded: false,
      scope: 'explicit_database_and_supplied_artifacts', exclusions: ['OS credentials','person/nickname/profile manifest unless separately supplied','unsupplied external archives/reports','broker operation','application restart'] };
    return { ...body, proofHash: sha256Hex(canonicalJson(body)) };
  } finally { db.close(); }
}
