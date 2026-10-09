import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NewsStorageService } from '@coqui/services';
import { listNewsObservationsAsOf, migrations, openDatabase, saveNewsObservation, type Db } from '@coqui/storage';
import { newsFixture } from './fixtures/news/observations.js';

const databases: Db[] = [], directories: string[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function db(path = ':memory:'): Db {
  const database = openDatabase(path); databases.push(database); return database;
}
function counts(database: Db): number[] {
  return ['news_articles_v1', 'news_provider_records_v1', 'news_observations_v1'].map(table =>
    (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('news storage foundation', () => {
  it('replays content idempotently and preserves three providers on one article', () => {
    const database = db();
    const first = saveNewsObservation(newsFixture(), 300, database);
    const replay = saveNewsObservation(newsFixture({ observedAtMs: 500 }), 600, database);
    expect(replay).toEqual({ inserted: false, stored: first.stored });
    saveNewsObservation(newsFixture({ provider: 'currents', url: 'https://publisher.example/story?gclid=x' }), 300, database);
    saveNewsObservation(newsFixture({ provider: 'gdelt', providerArticleId: null,
      url: 'https://publisher.example/story' }), 300, database);
    expect(counts(database)).toEqual([1, 3, 3]);
    expect(listNewsObservationsAsOf(300, 100, database)).toHaveLength(3);
    expect(first.stored.availableAtMs).toBe(300);
  });

  it('deduplicates missing IDs by provider and canonical URL', () => {
    const database = db(), value = newsFixture({ provider: 'gdelt', providerArticleId: null });
    expect(saveNewsObservation(value, 300, database).inserted).toBe(true);
    expect(saveNewsObservation(value, 400, database).inserted).toBe(false);
    saveNewsObservation({ ...value, url: 'https://publisher.example/other' }, 400, database);
    expect(counts(database)).toEqual([2, 2, 2]);
  });

  it('appends corrections and excludes later metadata from historical reads', () => {
    const database = db();
    saveNewsObservation(newsFixture(), 300, database);
    saveNewsObservation(newsFixture({ title: 'Correction', observedAtMs: 400 }), 500, database);
    expect(counts(database)).toEqual([1, 1, 2]);
    expect(listNewsObservationsAsOf(299, 100, database)).toEqual([]);
    expect(listNewsObservationsAsOf(499, 100, database)[0]?.observation.title).toBe(newsFixture().title);
    expect(listNewsObservationsAsOf(500, 100, database)[0]?.observation.title).toBe('Correction');
    saveNewsObservation(newsFixture({ observedAtMs: 600 }), 600, database);
    expect(listNewsObservationsAsOf(600, 100, database)[0]?.observation.title).toBe('Correction');
  });

  it('rejects URL reassignment and rolls back a batch including its earlier writes', () => {
    const database = db(), service = new NewsStorageService({ database, clock: { nowMs: () => 600 } });
    service.ingest([newsFixture()]);
    expect(() => service.ingest([newsFixture({ providerArticleId: 'new' }),
      newsFixture({ url: 'https://publisher.example/other' })])).toThrow('cannot change canonical URL');
    expect(counts(database)).toEqual([1, 1, 1]);
    expect(() => service.ingest([newsFixture({ providerArticleId: 'new' }),
      { ...newsFixture(), headers: { authorization: 'synthetic-secret' } }])).toThrow('Invalid news observation batch');
    expect(counts(database)).toEqual([1, 1, 1]);
  });

  it('gates delayed ingestion across UTC midnight by actual persistence, not publication', () => {
    const database = db(), midnight = Date.parse('2026-10-09T00:00:00Z');
    const service = new NewsStorageService({ database, clock: { nowMs: () => midnight + 100 } });
    service.ingest([newsFixture({ observedAtMs: midnight - 100, publishedAtMs: midnight - 86_400_000 })]);
    expect(service.asOf(midnight)).toEqual([]);
    expect(service.asOf(midnight + 100)).toHaveLength(1);
    expect(() => service.asOf(midnight + 101)).toThrow('future');
    expect(() => service.ingest([newsFixture({ observedAtMs: midnight + 101 })])).toThrow('persistence time');
  });

  it('enforces immutability, safe timestamps, bounds and foreign keys', () => {
    const database = db(); saveNewsObservation(newsFixture(), 300, database);
    for (const table of ['news_articles_v1', 'news_provider_records_v1', 'news_observations_v1']) {
      expect(() => database.exec(`DELETE FROM ${table}`)).toThrow('immutable');
      expect(() => database.exec(`UPDATE ${table} SET persisted_at=400`)).toThrow('immutable');
    }
    expect(() => saveNewsObservation(newsFixture(), 199, database)).toThrow('persistence time');
    expect(() => listNewsObservationsAsOf(NaN, 1, database)).toThrow();
    expect(() => listNewsObservationsAsOf(300, 251, database)).toThrow();
    expect(() => database.prepare(`INSERT INTO news_observations_v1 VALUES (?,?,?,?,?,?,?)`)
      .run('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 1, 0, 0, '{}')).toThrow('FOREIGN KEY');
    expect(Object.isFrozen(listNewsObservationsAsOf(300, 1, database)[0]?.observation.entities)).toBe(true);
  });

  it('isolates profile databases and keeps deterministic IDs after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coqui-news-')); directories.push(directory);
    const path = join(directory, 'profile.db'), database = db(path);
    const saved = saveNewsObservation(newsFixture(), 300, database);
    expect(listNewsObservationsAsOf(300, 100, db())).toEqual([]);
    database.close(); databases.splice(databases.indexOf(database), 1);
    const reopened = db(path);
    expect(listNewsObservationsAsOf(300, 100, reopened)).toEqual([saved.stored]);
    expect(saveNewsObservation(newsFixture(), 400, reopened).inserted).toBe(false);
  });

  it('fails closed on corrupted metadata and rejects unsafe SQL timestamps', () => {
    const database = db(), saved = saveNewsObservation(newsFixture(), 300, database);
    expect(() => database.prepare(`INSERT INTO news_articles_v1 VALUES (?,?,?,?,?,?)`)
      .run('a'.repeat(64), 'https://publisher.example/other', 'a'.repeat(64), 1, 0.5, 300)).toThrow('CHECK');
    expect(() => database.prepare(`INSERT INTO news_articles_v1 VALUES (?,?,?,?,?,?)`)
      .run('a'.repeat(64), 'https://publisher.example/other', 'a'.repeat(64), 1, 0, 9007199254740992)).toThrow('CHECK');
    database.exec('DROP TRIGGER news_observations_v1_no_update');
    database.prepare('UPDATE news_observations_v1 SET observation_json=? WHERE id=?')
      .run(JSON.stringify(newsFixture({ title: 'Tampered' })), saved.stored.observationId);
    expect(() => listNewsObservationsAsOf(300, 100, database)).toThrow('integrity validation');
  });

  it('rejects untrusted fields at the direct repository boundary and returns secret-safe errors', () => {
    const database = db(), service = new NewsStorageService({ database, clock: { nowMs: () => 300 } });
    const payload = { ...newsFixture(), headers: { authorization: 'synthetic-secret' } };
    expect(() => saveNewsObservation(payload, 300, database)).toThrow('Invalid news observation');
    expect(() => service.ingest([payload])).toThrow(/^Invalid news observation batch\.$/u);
    expect(() => service.ingest([])).toThrow('Invalid news observation batch');
    expect(counts(database)).toEqual([0, 0, 0]);
  });

  it('upgrades version 87 with a backup and preserves existing operational rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coqui-news-migration-')); directories.push(directory);
    const path = join(directory, 'profile.db');
    const prior = openDatabase(path, { migrations: migrations.slice(0, 87) });
    prior.exec('CREATE TABLE synthetic_existing_record(value TEXT); INSERT INTO synthetic_existing_record VALUES (\'preserved\')');
    prior.close();
    const upgraded = db(path);
    expect(upgraded.prepare('PRAGMA user_version').get()?.['user_version']).toBe(90);
    expect(upgraded.prepare('SELECT value FROM synthetic_existing_record').get()?.['value']).toBe('preserved');
    expect(readdirSync(directory).some(name => name.includes('pre-migration-v87') && name.endsWith('.bak'))).toBe(true);
    expect(counts(upgraded)).toEqual([0, 0, 0]);
  });
});
