import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NEWS_DAY_MS, NEWS_HOUR_MS, type NewsIntelligenceConfiguration } from '@coqui/core';
import { NewsIntelligenceService } from '@coqui/services';
import { listNewsRunAnalyses, listNewsRunClusters, migrations, openDatabase, readNewsAnalysisRun,
  saveNewsObservation, type Db } from '@coqui/storage';
import { newsFixture } from './fixtures/news/observations.js';

const BTC = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' } as const;
const config: NewsIntelligenceConfiguration = { schemaVersion: 1, reviewedAtMs: 100,
  instruments: [{ asset: 'BTC', instrument: BTC }], publisherAliases: [] };
const databases: Db[] = [], directories: string[] = [];
afterEach(() => {
  databases.splice(0).forEach(d => d.close());
  directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }));
});
function path(): string { const dir = mkdtempSync(join(tmpdir(), 'coqui-news-intelligence-')); directories.push(dir); return join(dir, 'fixture.db'); }
function db(file = ':memory:'): Db { const database = openDatabase(file); databases.push(database); return database; }
function seed(database: Db): void {
  database.prepare('INSERT INTO canonical_instruments VALUES (?,?,?,?,?,?,?,?,?)')
    .run('coinbase', 'BTC-USD', 'spot', 'BTC', 'Bitcoin', 'BTC', 'USD', 100, 100);
}
function service(database: Db, at: number): NewsIntelligenceService {
  return new NewsIntelligenceService({ database, clock: { nowMs: () => at } });
}

describe('news intelligence migration and durable evidence', () => {
  it('upgrades version 89 with a normal backup and preserves articles, settings and quotas', () => {
    const file = path(), prior = openDatabase(file, { migrations: migrations.filter(m => m.version <= 89) });
    seed(prior); saveNewsObservation(newsFixture({ title: 'Bitcoin gains' }), 300, prior);
    prior.prepare('INSERT INTO app_settings VALUES (?,?)').run('fixture-preserved', 'yes');
    prior.prepare('INSERT INTO news_api_usage_v1 VALUES (?,?,?,?,?,?,?)').run('gdelt', 'a'.repeat(64), '1970-01-01', 72, 1, 0, 0);
    prior.close(); const upgraded = db(file);
    expect(upgraded.prepare('PRAGMA user_version').get()?.['user_version']).toBe(90);
    expect(readdirSync(directories[0]!).some(name => name.includes('.pre-migration-v89-'))).toBe(true);
    expect(upgraded.prepare('SELECT value FROM app_settings WHERE key=?').get('fixture-preserved')?.['value']).toBe('yes');
    expect(upgraded.prepare('SELECT reserved FROM news_api_usage_v1').get()?.['reserved']).toBe(1);
    expect(service(upgraded, NEWS_HOUR_MS).analyze(config).analyses).toHaveLength(1);
  });
  it('reopens analysis evidence and replays across overlapping database connections', () => {
    const file = path(), first = db(file); seed(first);
    saveNewsObservation(newsFixture({ title: 'Bitcoin gains' }), 300, first);
    const result = service(first, NEWS_HOUR_MS).analyze(config);
    const second = db(file), replay = service(second, NEWS_HOUR_MS).analyze(config);
    expect(replay.inserted).toBe(false); expect(replay.run).toEqual(result.run);
    expect(listNewsRunAnalyses(result.run.id, second)).toEqual(result.analyses);
    expect(listNewsRunClusters(result.run.id, second)).toEqual([...result.clusters].sort((a, b) => a.id.localeCompare(b.id)));
    expect(second.prepare('SELECT count(*) AS n FROM news_analysis_runs_v1').get()?.['n']).toBe(1);
    expect(service(second, NEWS_HOUR_MS).featuresAsOf(BTC, NEWS_HOUR_MS)).toHaveLength(2);
  });
  it('uses the earlier metadata revision at midnight even when analysis runs after a correction', () => {
    const database = db(); seed(database); const midnight = NEWS_DAY_MS;
    saveNewsObservation(newsFixture({ title: 'Bitcoin gains', observedAtMs: midnight - 20 }), midnight - 10, database);
    saveNewsObservation(newsFixture({ title: 'Bitcoin falls', observedAtMs: midnight + 10 }), midnight + 20, database);
    const at = midnight + NEWS_HOUR_MS, s = service(database, at), result = s.analyze(config);
    expect(result.analyses).toHaveLength(2);
    const snapshots = s.featuresAsOf(BTC, at);
    expect(snapshots.find(f => f.cadence === 'daily')?.windows[1]?.sentimentMean).toBe(1);
    expect(snapshots.find(f => f.cadence === 'hourly')?.windows[1]?.sentimentMean).toBe(-1);
    expect(s.featuresAsOf(BTC, midnight)).toEqual([]); // Computation was not available at midnight.
  });
  it('appends alias and cluster revisions without changing earlier feature eligibility', () => {
    const database = db(); seed(database);
    saveNewsObservation(newsFixture({ title: 'Bitcoin gains', observedAtMs: NEWS_DAY_MS - 20 }), NEWS_DAY_MS - 10, database);
    const earlier = service(database, NEWS_DAY_MS).analyze(config);
    saveNewsObservation(newsFixture({ title: 'Bitcoin gains', provider: 'gdelt', providerArticleId: null,
      url: 'https://other.example/syndicated', sourceDomain: 'other.example', observedAtMs: NEWS_DAY_MS + 10 }), NEWS_DAY_MS + 20, database);
    const at = NEWS_DAY_MS + NEWS_HOUR_MS;
    const later = service(database, at).analyze({ ...config, reviewedAtMs: NEWS_DAY_MS,
      publisherAliases: [{ from: 'other.example', to: 'publisher.example' }] });
    expect(later.run.id).not.toBe(earlier.run.id);
    expect(service(database, at).featuresAsOf(BTC, NEWS_DAY_MS).find(f => f.cadence === 'daily')?.windows[1])
      .toMatchObject({ articleCount: 1, groupCount: 1, publisherCount: 1 });
    expect(service(database, at).featuresAsOf(BTC, at)[0]?.windows[1])
      .toMatchObject({ articleCount: 2, groupCount: 1, publisherCount: 1 });
    expect(readNewsAnalysisRun(earlier.run.id, database)).toEqual(earlier.run);
  });
  it('rejects invalid SQL timestamps, foreign keys and persisted evidence tampering', () => {
    const database = db(); seed(database);
    expect(() => database.prepare('INSERT INTO news_analysis_runs_v1 VALUES (?,?,?,?,?,?)')
      .run('a'.repeat(64), 200, 100, 300, 'b'.repeat(64), '{}')).toThrow('CHECK');
    expect(() => database.prepare('INSERT INTO news_observation_analyses_v1 VALUES (?,?,?,?)')
      .run('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), '{}')).toThrow('FOREIGN KEY');
    const result = service(database, NEWS_HOUR_MS).analyze(config);
    database.exec('DROP TRIGGER news_analysis_runs_v1_no_update');
    database.prepare('UPDATE news_analysis_runs_v1 SET evidence_json=? WHERE id=?').run('{}', result.run.id);
    expect(() => readNewsAnalysisRun(result.run.id, database)).toThrow('integrity');
  });
});
