import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { migrations as defaultMigrations, type Migration } from '../migrations/index.js';

export type Db = DatabaseSync;

export interface OpenDatabaseOptions {
  /** Override the complete migration manifest, primarily for compatibility tests. */
  readonly migrations?: readonly Migration[];
  readonly skipMigrations?: boolean;
  readonly backupBeforeMigration?: boolean;
  /** Supplies backup filename timestamps without hiding wall-clock access in tests. */
  readonly now?: () => number;
}

function schemaVersion(database: Db): number {
  const row = database.prepare('PRAGMA user_version').get() as
    | Record<string, unknown>
    | undefined;
  const value = row?.['user_version'];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('SQLite returned an invalid schema version.');
  }
  return value;
}

function validateMigrationManifest(list: readonly Migration[]): void {
  let expected = 1;
  for (const migration of list) {
    if (migration.version !== expected) {
      throw new Error('Migration manifest must be contiguous and ordered from version 1.');
    }
    if (!migration.name.trim()) throw new Error('Migration names must be non-empty.');
    expected += 1;
  }
}

function targetVersion(list: readonly Migration[]): number {
  return list.at(-1)?.version ?? 0;
}

function availableBackupPath(path: string, version: number, now: number): string {
  const base = `${path}.pre-migration-v${version}-${now}`;
  let candidate = `${base}.bak`;
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = `${base}-${suffix}.bak`;
    suffix += 1;
  }
  return candidate;
}

/** Create a consistent SQLite backup without copying a live WAL file directly. */
export function backupDatabase(database: Db, destination: string): void {
  database.prepare('VACUUM INTO ?').run(destination);
}

/**
 * Apply pending migrations in one immediate transaction. A failed migration
 * rolls back both its schema changes and `user_version` advancement.
 */
export function runMigrations(
  database: Db,
  list: readonly Migration[] = defaultMigrations,
): number {
  validateMigrationManifest(list);
  const current = schemaVersion(database);
  const target = targetVersion(list);
  if (current > target) {
    throw new Error('The database schema is newer than this application supports.');
  }
  const pending = list.filter((migration) => migration.version > current);
  if (pending.length === 0) return current;

  database.exec('BEGIN IMMEDIATE');
  try {
    let version = current;
    for (const migration of pending) {
      migration.up(database);
      version = migration.version;
    }
    database.exec(`PRAGMA user_version = ${version}`);
    database.exec('COMMIT');
    return version;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

/** Run one repository mutation atomically, joining an existing outer transaction. */
export function inTransaction<T>(database: Db, operation: () => T): T {
  if (database.isTransaction) return operation();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

/** Open a hardened local database and migrate it only after a verified backup. */
export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Db {
  if (!path || path.includes('\0')) throw new TypeError('Invalid SQLite database path.');
  const memory = path === ':memory:';
  const existedBefore = !memory && existsSync(path);
  if (!memory) mkdirSync(dirname(path), { recursive: true });

  const database = new DatabaseSync(path, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    allowExtension: false,
  });
  try {
    database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    if (options.skipMigrations === true) return database;
    const list = options.migrations ?? defaultMigrations;
    validateMigrationManifest(list);
    const current = schemaVersion(database);
    const target = targetVersion(list);
    if (current > target) {
      throw new Error('The database schema is newer than this application supports.');
    }
    if (
      existedBefore &&
      target > current &&
      options.backupBeforeMigration !== false
    ) {
      const destination = availableBackupPath(path, current, (options.now ?? Date.now)());
      try {
        backupDatabase(database, destination);
      } catch (error) {
        throw new Error('Database migration backup failed; the original was not changed.', {
          cause: error,
        });
      }
    }
    runMigrations(database, list);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
