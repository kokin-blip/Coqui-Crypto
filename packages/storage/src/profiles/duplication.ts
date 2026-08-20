import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { backupDatabase } from '../sqlite/index.js';

export interface DuplicateProfileDatabaseInput {
  readonly sourceProfileId: string;
  readonly sourceDbFilename: string;
  readonly targetProfileId: string;
  readonly targetDbFilename: string;
}

export interface ProfileDatabaseDuplicationEvidence {
  readonly schemaVersion: number;
  readonly databaseSha256: string;
  readonly profileScopedTableCount: number;
  readonly rewrittenRowCount: number;
  readonly excludedTransientRowCount: number;
  readonly clearedCredentialMetadataCount: number;
  readonly integrityVerified: true;
}

export type ProfileDatabaseDuplicationErrorCode =
  | 'invalid_input'
  | 'source_unavailable'
  | 'destination_conflict'
  | 'destination_unavailable'
  | 'foreign_profile_identity'
  | 'verification_failed';

export type ProfileDatabaseDuplicationResult =
  | { readonly ok: true; readonly evidence: ProfileDatabaseDuplicationEvidence }
  | { readonly ok: false; readonly code: ProfileDatabaseDuplicationErrorCode };

export interface ProfileDatabaseDuplicator {
  duplicate(input: DuplicateProfileDatabaseInput): Promise<ProfileDatabaseDuplicationResult>;
  discard(targetProfileId: string, targetDbFilename: string): Promise<{ readonly ok: boolean }>;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

function inside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}

function safeSourceFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !value.includes('\0') && !value.includes('/') && !value.includes('\\') && value.endsWith('.db');
}

function validInput(input: DuplicateProfileDatabaseInput): boolean {
  return PROFILE_ID.test(input.sourceProfileId) && UUID_V4.test(input.targetProfileId) &&
    input.sourceProfileId.toLowerCase() !== input.targetProfileId.toLowerCase() &&
    safeSourceFilename(input.sourceDbFilename) &&
    input.targetDbFilename === `wallet-${input.targetProfileId.toLowerCase()}.db`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function safeCount(value: unknown): number | null {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isSafeInteger(converted) && converted >= 0 ? converted : null;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function schemaVersion(database: DatabaseSync): number | null {
  const row = database.prepare('PRAGMA user_version').get() as Record<string, unknown>;
  return safeCount(row['user_version']);
}

function integrityValid(database: DatabaseSync): boolean {
  const row = database.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
  return row['integrity_check'] === 'ok' && database.prepare('PRAGMA foreign_key_check').all().length === 0;
}

function databaseHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function countQuery(database: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): number {
  const row = database.prepare(sql).get(...parameters) as Record<string, unknown>;
  const count = safeCount(row['count']);
  if (count === null) throw new RangeError('Invalid duplication exclusion count.');
  return count;
}

/** Clone a SQLite profile snapshot and rewrite every explicit profile identity transactionally. */
export function createFileProfileDatabaseDuplicator(profilesDirectory: string): ProfileDatabaseDuplicator {
  if (!profilesDirectory) throw new TypeError('A profile database root is required.');

  return Object.freeze({
    async duplicate(
      input: DuplicateProfileDatabaseInput,
    ): Promise<ProfileDatabaseDuplicationResult> {
      if (!validInput(input)) return { ok: false, code: 'invalid_input' };
      let root: string;
      try {
        root = realpathSync(profilesDirectory);
      } catch {
        return { ok: false, code: 'source_unavailable' };
      }
      const sourceCandidate = resolve(root, input.sourceDbFilename);
      const targetPath = resolve(root, input.targetDbFilename);
      const temporaryPath = resolve(root, `.tmp-duplicate-${input.targetProfileId.toLowerCase()}.db`);
      if (!inside(root, sourceCandidate) || !inside(root, targetPath) || !inside(root, temporaryPath)) {
        return { ok: false, code: 'invalid_input' };
      }
      let sourcePath: string;
      try {
        if (!existsSync(sourceCandidate) || !statSync(sourceCandidate).isFile()) {
          return { ok: false, code: 'source_unavailable' };
        }
        sourcePath = realpathSync(sourceCandidate);
        if (!inside(root, sourcePath)) return { ok: false, code: 'source_unavailable' };
      } catch {
        return { ok: false, code: 'source_unavailable' };
      }
      if (existsSync(targetPath) || existsSync(temporaryPath)) {
        return { ok: false, code: 'destination_conflict' };
      }

      let stage: 'destination' | 'identity' | 'verification' = 'destination';
      let source: DatabaseSync | null = null;
      let target: DatabaseSync | null = null;
      try {
        source = new DatabaseSync(sourcePath, { readOnly: true, allowExtension: false });
        backupDatabase(source, temporaryPath);
        source.close();
        source = null;

        stage = 'identity';
        target = new DatabaseSync(temporaryPath, {
          allowExtension: false,
          enableForeignKeyConstraints: true,
        });
        target.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON;');
        const tableRows = target.prepare(`
          SELECT DISTINCT m.name AS table_name
          FROM sqlite_master m
          JOIN pragma_table_info(m.name) p ON p.name = 'profile_id'
          WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
          ORDER BY m.name
        `).all() as Array<Record<string, unknown>>;
        const tableNames = tableRows.map((row) => row['table_name']);
        if (tableNames.some((name) => typeof name !== 'string' || name.length === 0)) {
          throw new TypeError('Invalid profile-scoped table identity.');
        }
        let rewrittenRowCount = 0;
        for (const tableName of tableNames as string[]) {
          const table = quoteIdentifier(tableName);
          const identities = target.prepare(
            `SELECT profile_id, COUNT(*) AS count FROM ${table} GROUP BY profile_id`,
          ).all() as Array<Record<string, unknown>>;
          for (const identity of identities) {
            const count = safeCount(identity['count']);
            if (identity['profile_id'] !== input.sourceProfileId || count === null) {
              throw new RangeError('Foreign profile identity detected.');
            }
            rewrittenRowCount += count;
            if (!Number.isSafeInteger(rewrittenRowCount)) {
              throw new RangeError('Profile row count overflow.');
            }
          }
          target.prepare(`UPDATE ${table} SET profile_id = ? WHERE profile_id = ?`).run(
            input.targetProfileId.toLowerCase(),
            input.sourceProfileId,
          );
        }

        const pendingImportRows = countQuery(target, `
          SELECT
            COUNT(*) +
            (SELECT COUNT(*) FROM coinbase_import_stage_lots
              WHERE job_id IN (SELECT id FROM coinbase_import_jobs
                WHERE profile_id = ? AND status IN ('staging', 'needs_resolution'))) +
            (SELECT COUNT(*) FROM coinbase_import_stage_disposals
              WHERE job_id IN (SELECT id FROM coinbase_import_jobs
                WHERE profile_id = ? AND status IN ('staging', 'needs_resolution'))) +
            (SELECT COUNT(*) FROM coinbase_import_discrepancies
              WHERE job_id IN (SELECT id FROM coinbase_import_jobs
                WHERE profile_id = ? AND status IN ('staging', 'needs_resolution')))
            AS count
          FROM coinbase_import_jobs
          WHERE profile_id = ? AND status IN ('staging', 'needs_resolution')
        `, input.targetProfileId.toLowerCase(), input.targetProfileId.toLowerCase(),
        input.targetProfileId.toLowerCase(), input.targetProfileId.toLowerCase());
        const scheduleRows = countQuery(
          target,
          'SELECT COUNT(*) AS count FROM wallet_schedule_lease WHERE profile_id = ?',
          input.targetProfileId.toLowerCase(),
        );
        target.prepare(`
          DELETE FROM coinbase_import_jobs
          WHERE profile_id = ? AND status IN ('staging', 'needs_resolution')
        `).run(input.targetProfileId.toLowerCase());
        target.prepare('DELETE FROM wallet_schedule_lease WHERE profile_id = ?')
          .run(input.targetProfileId.toLowerCase());
        const credentialMetadataKeys = [
          'credentials.coinbase.v2',
          'credentials.coinbase.v3.status',
          'credentials.gemini.v2',
          'coinbase.last_sync_at',
        ] as const;
        const clearedCredentialMetadataCount = countQuery(
          target,
          `SELECT COUNT(*) AS count FROM app_settings WHERE key IN (${credentialMetadataKeys.map(() => '?').join(', ')})`,
          ...credentialMetadataKeys,
        );
        target.prepare(
          `DELETE FROM app_settings WHERE key IN (${credentialMetadataKeys.map(() => '?').join(', ')})`,
        ).run(...credentialMetadataKeys);
        const excludedTransientRowCount = pendingImportRows + scheduleRows;
        if (!Number.isSafeInteger(excludedTransientRowCount)) {
          throw new RangeError('Duplication exclusion count overflow.');
        }
        target.exec('COMMIT');

        stage = 'verification';
        for (const tableName of tableNames as string[]) {
          const table = quoteIdentifier(tableName);
          const row = target.prepare(
            `SELECT COUNT(*) AS count FROM ${table} WHERE profile_id <> ? OR profile_id IS NULL`,
          ).get(input.targetProfileId.toLowerCase()) as Record<string, unknown>;
          if (safeCount(row['count']) !== 0) throw new Error('Profile identity rewrite failed.');
        }
        const version = schemaVersion(target);
        if (version === null || !integrityValid(target)) throw new Error('Duplicated database failed verification.');
        target.close();
        target = null;
        renameSync(temporaryPath, targetPath);
        const finalDatabase = new DatabaseSync(targetPath, { readOnly: true, allowExtension: false });
        try {
          if (schemaVersion(finalDatabase) !== version || !integrityValid(finalDatabase)) {
            throw new Error('Published database failed verification.');
          }
        } finally {
          finalDatabase.close();
        }
        return {
          ok: true,
          evidence: Object.freeze({
            schemaVersion: version,
            databaseSha256: databaseHash(targetPath),
            profileScopedTableCount: tableNames.length,
            rewrittenRowCount,
            excludedTransientRowCount,
            clearedCredentialMetadataCount,
            integrityVerified: true,
          }),
        };
      } catch (error) {
        if (target?.isTransaction) {
          try {
            target.exec('ROLLBACK');
          } catch {
            // The temporary clone is discarded below.
          }
        }
        const identityFailure = stage === 'identity' && error instanceof RangeError;
        return {
          ok: false,
          code: identityFailure ? 'foreign_profile_identity'
            : stage === 'destination' ? 'destination_unavailable'
              : 'verification_failed',
        };
      } finally {
        try {
          target?.close();
        } catch {
          // The temporary clone is discarded below.
        }
        try {
          source?.close();
        } catch {
          // Read-only source cleanup is best effort.
        }
        try {
          if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
        } catch {
          // Cleanup is restricted to the validated temporary child.
        }
      }
    },

    async discard(targetProfileId: string, targetDbFilename: string): Promise<{ readonly ok: boolean }> {
      if (!UUID_V4.test(targetProfileId) ||
        targetDbFilename !== `wallet-${targetProfileId.toLowerCase()}.db`) return { ok: false };
      try {
        const root = realpathSync(profilesDirectory);
        const paths = ['', '-wal', '-shm'].map((suffix) => resolve(root, `${targetDbFilename}${suffix}`));
        if (paths.some((path) => !inside(root, path))) return { ok: false };
        for (const path of paths) rmSync(path, { force: true });
        return { ok: paths.every((path) => !existsSync(path)) };
      } catch {
        return { ok: false };
      }
    },
  });
}
