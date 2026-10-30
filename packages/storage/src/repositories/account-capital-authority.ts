import { closeSync, lstatSync, openSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { assertAccountAuthorityHash, assertAccountAuthorityTime, capitalHash, canonicalJson,
  reduceAccountAuthorityCommand, validateAccountAuthorityCommand,
  type AccountAuthorityCommand, type AccountAuthorityHead, type CanonicalJsonValue } from '@coqui/core';

import { backupDatabase, inTransaction, type Db } from '../sqlite/index.js';

const APPLICATION_ID = 0x43415131;
const FORMAT = 1;
const JOURNAL = Symbol('account-authority-evidence-journal');
export interface AccountAuthorityJournal {
  readonly [JOURNAL]: true; readonly database: Db; readonly registryId: string;
  close(): void;
}
const schema = `
  CREATE TABLE account_authority_meta_v1 (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), registry_id TEXT NOT NULL CHECK(length(registry_id)=64),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0));
  CREATE TABLE account_authority_scopes_v1 (
    scope_id TEXT PRIMARY KEY CHECK(length(scope_id)=64), account_identity_hash TEXT NOT NULL UNIQUE CHECK(length(account_identity_hash)=64));
  CREATE TABLE account_authority_events_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES account_authority_scopes_v1(scope_id),
    sequence INTEGER NOT NULL CHECK(sequence>0), predecessor_id TEXT REFERENCES account_authority_events_v1(id),
    content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
    UNIQUE(scope_id,sequence));
  CREATE TABLE account_authority_commands_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES account_authority_scopes_v1(scope_id),
    request_hash TEXT NOT NULL CHECK(length(request_hash)=64), event_id TEXT NOT NULL REFERENCES account_authority_events_v1(id));
  CREATE TABLE account_authority_heads_v1 (
    scope_id TEXT PRIMARY KEY REFERENCES account_authority_scopes_v1(scope_id),
    event_id TEXT NOT NULL UNIQUE REFERENCES account_authority_events_v1(id));
`;
function json(value: unknown): string { return canonicalJson(value as CanonicalJsonValue); }
function checkDatabase(database: Db, expectedRegistryId: string): void {
  if (database.prepare('PRAGMA application_id').get()?.['application_id'] !== APPLICATION_ID) throw new Error('account_authority_wrong_database');
  if (database.prepare('PRAGMA user_version').get()?.['user_version'] !== FORMAT) throw new Error('account_authority_unsupported_format');
  const meta = database.prepare('SELECT registry_id FROM account_authority_meta_v1 WHERE singleton=1').get();
  if (meta?.['registry_id'] !== expectedRegistryId) throw new Error('account_authority_registry_mismatch');
}
function handle(database: Db, registryId: string): AccountAuthorityJournal {
  checkDatabase(database, registryId);
  return Object.freeze({ [JOURNAL]: true as const, database, registryId, close: () => database.close() });
}
function databaseFor(journal: AccountAuthorityJournal): Db {
  if (journal[JOURNAL] !== true) throw new Error('account_authority_journal_required');
  checkDatabase(journal.database, journal.registryId);
  return journal.database;
}
function filePath(path: string): void {
  if (!isAbsolute(path) || path.includes('\0')) throw new TypeError('account_authority_explicit_path_required');
}

/** Separate evidence store; never opens a profile or installs a profile migration. No default path. */
export function createAccountAuthorityJournal(input: { readonly path: string; readonly registryId: string; readonly atMs: number }): AccountAuthorityJournal {
  assertAccountAuthorityHash(input.registryId); assertAccountAuthorityTime(input.atMs); filePath(input.path);
  // Exclusive creation refuses an existing database, including a profile, backup or symlink.
  closeSync(openSync(input.path, 'wx', 0o600));
  const database = new DatabaseSync(input.path, { timeout: 5_000, enableForeignKeyConstraints: true, allowExtension: false });
  try {
    inTransaction(database, () => {
      database.exec(schema);
      for (const table of ['meta', 'scopes', 'events', 'commands']) {
        for (const action of ['UPDATE', 'DELETE']) database.exec(`CREATE TRIGGER account_authority_${table}_no_${action.toLowerCase()}
          BEFORE ${action} ON account_authority_${table}_v1 BEGIN SELECT RAISE(ABORT,'account authority evidence is immutable'); END;`);
      }
      database.prepare('INSERT INTO account_authority_meta_v1 VALUES(1,?,?)').run(input.registryId, input.atMs);
      database.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${FORMAT};`);
    });
    database.exec('PRAGMA journal_mode=WAL;');
    return handle(database, input.registryId);
  } catch (error) { database.close(); throw error; } // Failed initialization is never silently recreated.
}

/** Reopen only this exact format/registry. Never migrates, resets, takes over or enrolls. */
export function openAccountAuthorityJournal(path: string, registryId: string): AccountAuthorityJournal {
  assertAccountAuthorityHash(registryId); filePath(path);
  if (!lstatSync(path).isFile()) throw new Error('account_authority_regular_file_required');
  const database = new DatabaseSync(path, { timeout: 5_000, enableForeignKeyConstraints: true, allowExtension: false });
  try { return handle(database, registryId); }
  catch (error) { database.close(); throw error; }
}

interface JournalEvent {
  readonly predecessorId: string | null; readonly command: AccountAuthorityCommand; readonly head: AccountAuthorityHead;
}
function readEvent(database: Db, id: string, registryId: string): JournalEvent {
  const row = database.prepare('SELECT scope_id,sequence,predecessor_id,content_json,content_hash FROM account_authority_events_v1 WHERE id=?').get(id);
  if (!row || typeof row['content_json'] !== 'string') throw new Error('account_authority_event_missing');
  const event = JSON.parse(row['content_json']) as JournalEvent;
  const { id: headId, ...body } = event.head;
  if (capitalHash(event) !== row['content_hash'] || headId !== id || capitalHash(body) !== id || event.head.registryId !== registryId ||
    event.head.scopeId !== row['scope_id'] || event.head.sequence !== row['sequence'] || event.predecessorId !== row['predecessor_id'] ||
    event.head.requestHash !== capitalHash(event.command)) throw new Error('account_authority_integrity_failed');
  return event;
}
export function getAccountAuthorityHead(journal: AccountAuthorityJournal, scopeId: string): AccountAuthorityHead | null {
  assertAccountAuthorityHash(scopeId);
  const database = databaseFor(journal);
  const row = database.prepare('SELECT event_id FROM account_authority_heads_v1 WHERE scope_id=?').get(scopeId);
  if (!row) {
    if (database.prepare('SELECT scope_id FROM account_authority_scopes_v1 WHERE scope_id=?').get(scopeId)) {
      throw new Error('account_authority_integrity_failed');
    }
    return null;
  }
  const head = readEvent(database, String(row['event_id']), journal.registryId).head;
  if (head.scopeId !== scopeId) throw new Error('account_authority_integrity_failed');
  return head;
}

/** Durable idempotent preparation only. Checkpoint references are unverified and never fund cash. */
export function recordAccountAuthorityCommand(journal: AccountAuthorityJournal, command: AccountAuthorityCommand): AccountAuthorityHead {
  validateAccountAuthorityCommand(command);
  const database = databaseFor(journal), requestHash = capitalHash(command);
  return inTransaction(database, () => {
    const retry = database.prepare('SELECT scope_id,request_hash,event_id FROM account_authority_commands_v1 WHERE id=?').get(command.id);
    if (retry) {
      if (retry['scope_id'] !== command.scopeId || retry['request_hash'] !== requestHash) throw new Error('account_authority_command_conflict');
      const event = readEvent(database, String(retry['event_id']), journal.registryId);
      if (json(event.command) !== json(command)) throw new Error('account_authority_integrity_failed');
      return event.head;
    }
    const prior = getAccountAuthorityHead(journal, command.scopeId);
    const head = reduceAccountAuthorityCommand(journal.registryId, prior, command);
    if (prior === null) database.prepare('INSERT INTO account_authority_scopes_v1 VALUES(?,?)').run(head.scopeId, head.accountIdentityHash);
    const event: JournalEvent = { predecessorId: prior?.id ?? null, command, head };
    database.prepare('INSERT INTO account_authority_events_v1 VALUES(?,?,?,?,?,?)')
      .run(head.id, head.scopeId, head.sequence, prior?.id ?? null, json(event), capitalHash(event));
    database.prepare('INSERT INTO account_authority_commands_v1 VALUES(?,?,?,?)').run(command.id, head.scopeId, requestHash, head.id);
    if (prior === null) database.prepare('INSERT INTO account_authority_heads_v1 VALUES(?,?)').run(head.scopeId, head.id);
    else if (Number(database.prepare('UPDATE account_authority_heads_v1 SET event_id=? WHERE scope_id=? AND event_id=?')
      .run(head.id, head.scopeId, prior.id).changes) !== 1) throw new Error('account_authority_stale_head');
    return head;
  });
}

/** Consistent backup retains identity/history; a copied journal still supplies no execution permit. */
export function backupAccountAuthorityJournal(journal: AccountAuthorityJournal, destination: string): void {
  filePath(destination); backupDatabase(databaseFor(journal), destination);
}
