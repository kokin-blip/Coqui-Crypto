import { afterEach, describe, expect, it } from 'vitest';
import { analyzeNewsObservation, buildNewsFeatureSnapshot, clusterNewsAnalyses, instrumentKey, NEWS_DAY_MS,
  NEWS_HOUR_MS, newsEvidenceHash, newsSyndicationMatch, type NewsFeatureSnapshot, type NewsIntelligenceConfiguration,
  type NewsObservationAnalysis } from '@coqui/core';
import { newsAnalysisRunSchema, newsFeatureSnapshotSchema, newsIntelligenceConfigurationSchema,
  newsObservationAnalysisSchema } from '@coqui/contracts';
import { NewsIntelligenceService } from '@coqui/services';
import { listNewsFeaturesAsOf, newsAnalysisRunId, openDatabase, pageNewsObservationsAsOf, readNewsCoverage,
  saveNewsIntelligenceBatch, saveNewsObservation, type Db } from '@coqui/storage';
import { newsFixture } from './fixtures/news/observations.js';

const BTC = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' } as const;
const ETH = { ...BTC, productId: 'ETH-USD' };
const configuration: NewsIntelligenceConfiguration = { schemaVersion: 1, reviewedAtMs: 100,
  instruments: [{ asset: 'BTC', instrument: BTC }, { asset: 'ETH', instrument: ETH }], publisherAliases: [] };
const registry = configuration.instruments.map(i => ({ ...i, name: i.asset === 'BTC' ? 'Bitcoin' : 'Ethereum',
  baseAsset: i.asset, quoteAsset: 'USD', createdAtMs: 100, updatedAtMs: 100 }));
const databases: Db[] = [];
afterEach(() => databases.splice(0).forEach(d => d.close()));
function db(): Db {
  const database = openDatabase(':memory:'); databases.push(database);
  for (const r of registry) database.prepare(`INSERT INTO canonical_instruments VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(r.instrument.venue, r.instrument.productId, r.instrument.productType, r.asset, r.name, r.baseAsset, r.quoteAsset, 100, 100);
  return database;
}
function analysis(title = 'Bitcoin gains', overrides: Parameters<typeof newsFixture>[0] = {}): NewsObservationAnalysis {
  const database = db();
  const stored = saveNewsObservation(newsFixture({ title, ...overrides }), 300, database).stored;
  return analyzeNewsObservation(stored, configuration, registry);
}
function feature(analyses: readonly NewsObservationAnalysis[], baseline: readonly NewsFeatureSnapshot[] = [], at = NEWS_DAY_MS): NewsFeatureSnapshot {
  return buildNewsFeatureSnapshot({ runId: newsEvidenceHash('run'), instrument: BTC, cadence: 'daily', decisionAtMs: at,
    availableAtMs: at, analyses, clusters: clusterNewsAnalyses(analyses), baseline, coverage: [], reconstruction: false });
}

describe('news resolution and instrument-specific rules', () => {
  it('resolves explicit names and crypto-qualified symbols only', () => {
    expect(analysis('Bitcoin adoption').instruments[0]?.instrument).toEqual(BTC);
    expect(analysis('BTC token gains').instruments[0]?.sentimentScore).toBe(1);
    const ambiguous = analysis('BTC rises');
    expect(ambiguous.instruments).toEqual([]);
    expect(ambiguous.resolutions.every(r => r.reason === 'ambiguous_ticker')).toBe(true);
  });
  it('preserves equities and unsupported candidates instead of ticker joining', () => {
    const result = analysis('Company gains', { entities: [
      { symbol: 'BTC', assetClass: 'equity', providerEntityType: 'company', exchange: 'NYSE', matchScore: 3, sentimentScore: 0.5 },
      { symbol: 'USD', assetClass: 'unknown', providerEntityType: null, exchange: null, matchScore: null, sentimentScore: null },
    ] });
    expect(result.instruments).toEqual([]);
    expect(result.resolutions.map(r => r.reason)).toEqual(['equity', 'quote_currency']);
  });
  it('does not resolve similarly named forks, wrapped assets or quote mentions', () => {
    expect(analysis('Bitcoin Cash gains').instruments).toEqual([]);
    expect(analysis('Wrapped Bitcoin gains').instruments).toEqual([]);
    expect(analysis('Ethereum Classic gains').instruments).toEqual([]);
    expect(analysis('Bitcoin quoted in Ethereum').resolutions.find(r => r.asset === 'ETH')?.reason).toBe('quote_currency');
  });
  it('does not create missing registry identities', () => {
    const value = saveNewsObservation(newsFixture({ title: 'Bitcoin adoption' }), 300, db()).stored;
    const result = analyzeNewsObservation(value, configuration, []);
    expect(result.instruments).toEqual([]);
    expect(result.resolutions[0]?.reason).toBe('missing_registry');
  });
  it('assigns opposing tones to separate instrument clauses', () => {
    const result = analysis('Bitcoin gains while Ethereum falls');
    expect(result.instruments.map(i => i.sentimentScore)).toEqual([1, -1]);
  });
  it('returns unknown for shared clauses, negation and conflicting tone', () => {
    expect(analysis('Bitcoin gains at Ethereum expense').instruments.map(i => i.sentimentScore)).toEqual([null, null]);
    expect(analysis('Bitcoin did not gain approval').instruments[0]?.sentimentScore).toBeNull();
    expect(analysis('Bitcoin gains. Bitcoin falls').instruments[0]?.sentimentReason).toBe('conflicting');
  });
  it('preserves provider relevance above one and sentiment independently', () => {
    const value = analysis('Bitcoin hack', { entities: [{ symbol: 'BTC', assetClass: 'crypto', providerEntityType: 'cryptocurrency',
      exchange: null, matchScore: 12.1, sentimentScore: 0.7 }] });
    expect(value.instruments[0]?.sentimentScore).toBe(-1);
    expect(value.instruments[0]?.providerEntities[0]?.entity).toMatchObject({ matchScore: 12.1, sentimentScore: 0.7 });
    expect(value.eventLabel).toBe('security');
  });
  it('recognizes GDELT English labels and provider-qualified ticker clauses', () => {
    expect(analysis('Bitcoin gains', { provider: 'gdelt', language: 'English' }).instruments[0]?.sentimentScore).toBe(1);
    expect(analysis('BTC gains', { entities: [{ symbol: 'BTC', assetClass: 'crypto', providerEntityType: null,
      exchange: null, matchScore: 2, sentimentScore: null }] }).instruments[0]?.sentimentScore).toBe(1);
  });
  it('rejects an oversized syndication group before allocating unbounded pair evidence', () => {
    const value = analysis();
    const copies = Array.from({ length: 317 }, (_, i) => ({ ...value, articleId: newsEvidenceHash(['article', i]),
      observationId: newsEvidenceHash(['observation', i]), providerRecordId: newsEvidenceHash(['record', i]) }));
    expect(() => clusterNewsAnalyses(copies)).toThrow('bound');
  });
  it('does not invent sentiment for missing or unsupported language', () => {
    expect(analysis('Bitcoin gains', { language: 'es' }).instruments[0]?.sentimentReason).toBe('unsupported_language');
    expect(analysis('Bitcoin gains', { language: null }).instruments[0]?.sentimentScore).toBeNull();
    expect(analysis('Bitcoin statement').instruments[0]?.sentimentScore).toBeNull();
  });
  it('validates schemas, time bounds, configuration and sentiment consistency', () => {
    expect(newsIntelligenceConfigurationSchema.safeParse({ ...configuration, secret: 'synthetic' }).success).toBe(false);
    expect(newsIntelligenceConfigurationSchema.safeParse({ ...configuration, reviewedAtMs: -1 }).success).toBe(false);
    expect(newsIntelligenceConfigurationSchema.safeParse({ ...configuration, instruments: [...configuration.instruments, configuration.instruments[0]] }).success).toBe(false);
    const value = analysis();
    expect(newsObservationAnalysisSchema.safeParse(value).success).toBe(true);
    expect(newsObservationAnalysisSchema.safeParse({ ...value, instruments: [{ ...value.instruments[0], sentimentScore: 2 }] }).success).toBe(false);
    expect(newsFeatureSnapshotSchema.safeParse({ ...feature([value]), decisionAtMs: 1 }).success).toBe(false);
  });
});

describe('syndication and source diversity', () => {
  it('groups exact-title cross-URL stories while preserving provider provenance', () => {
    const a = analysis(), b = analysis('Bitcoin gains', { url: 'https://other.example/story', provider: 'gdelt' });
    const clusters = clusterNewsAnalyses([a, b]);
    expect(clusters).toHaveLength(1); expect(clusters[0]?.articleIds).toHaveLength(2);
    expect(clusters[0]?.observationIds).toHaveLength(2);
    expect(clusterNewsAnalyses([b, a])).toEqual(clusters);
    expect(feature([a, b]).windows[1]).toMatchObject({ articleCount: 2, groupCount: 1, sentimentSampleCount: 1 });
  });
  it('requires similarity, time bounds and supporting descriptions', () => {
    const a = analysis('Bitcoin adoption rises across major global crypto markets today');
    const b = { ...a, articleId: newsEvidenceHash('b'), providerRecordId: newsEvidenceHash('b-record'), observationId: newsEvidenceHash('b-o'),
      title: 'Bitcoin adoption rises across major global crypto markets now' };
    expect(newsSyndicationMatch(a, b)).toBeNull(); // 8/10 shared tokens is below .85.
    expect(newsSyndicationMatch(a, { ...b, title: a.title, firstAvailableAtMs: NEWS_DAY_MS + 301 })).toBeNull();
    expect(newsSyndicationMatch({ ...a, description: 'One entirely different narrative' },
      { ...b, title: `${a.title} again`, description: 'Unrelated separate reporting context' })).toBeNull();
  });
  it('uses complete-link grouping rather than transitive chaining', () => {
    const a = analysis('Bitcoin one two three four five six seven eight nine ten');
    const b = { ...a, articleId: newsEvidenceHash('b'), providerRecordId: newsEvidenceHash('br'), observationId: newsEvidenceHash('bo'), title: `${a.title} eleven` };
    const c = { ...a, articleId: newsEvidenceHash('c'), providerRecordId: newsEvidenceHash('cr'), observationId: newsEvidenceHash('co'), title: `${b.title} twelve thirteen` };
    expect(newsSyndicationMatch(a, b)).not.toBeNull();
    expect(newsSyndicationMatch(b, c)).not.toBeNull();
    expect(newsSyndicationMatch(a, c)).toBeNull();
    expect(clusterNewsAnalyses([a, b, c])).toHaveLength(2);
  });
  it('counts publishers independently of providers and applies explicit host aliases', () => {
    const database = db(), config = { ...configuration, publisherAliases: [{ from: 'www.publisher.example', to: 'publisher.example' }] };
    const a = analyzeNewsObservation(saveNewsObservation(newsFixture({ title: 'Bitcoin gains' }), 300, database).stored, config, registry);
    const b = analyzeNewsObservation(saveNewsObservation(newsFixture({ title: 'Bitcoin gains', provider: 'currents',
      sourceDomain: 'www.publisher.example' }), 300, database).stored, config, registry);
    expect(feature([a, b]).windows[1]).toMatchObject({ articleCount: 1, groupCount: 1, publisherCount: 1 });
  });
});

describe('analysis storage and point-in-time features', () => {
  it('records actual completion and persistence and replays without overwriting evidence', () => {
    const database = db(); saveNewsObservation(newsFixture({ title: 'Bitcoin gains', observedAtMs: NEWS_HOUR_MS - 10 }), NEWS_HOUR_MS - 5, database);
    const times = [NEWS_HOUR_MS, NEWS_HOUR_MS + 2, NEWS_HOUR_MS + 3];
    const service = new NewsIntelligenceService({ database, clock: { nowMs: () => times.shift() ?? NEWS_HOUR_MS + 4 } });
    const result = service.analyze(configuration);
    expect(result.run).toMatchObject({ completedAtMs: NEWS_HOUR_MS + 2, persistedAtMs: NEWS_HOUR_MS + 3 });
    expect(newsAnalysisRunSchema.safeParse(result.run).success).toBe(true);
    expect(service.featuresAsOf(BTC, NEWS_HOUR_MS + 2)).toEqual([]);
    expect(service.featuresAsOf(BTC, NEWS_HOUR_MS + 3)).toHaveLength(2);
    expect(service.analyze(configuration, { inputCutoffMs: NEWS_HOUR_MS }).inserted).toBe(false);
    for (const table of ['news_analysis_runs_v1', 'news_observation_analyses_v1', 'news_cluster_snapshots_v1', 'news_feature_snapshots_v1']) {
      expect(() => database.exec(`DELETE FROM ${table}`)).toThrow('immutable');
      expect(() => database.exec(`UPDATE ${table} SET content_hash=content_hash`)).toThrow('immutable');
    }
  });
  it('excludes delayed ingestion, later corrections and newer mappings from old cutoffs', () => {
    const database = db(); let now = NEWS_DAY_MS;
    const service = new NewsIntelligenceService({ database, clock: { nowMs: () => now } });
    saveNewsObservation(newsFixture({ title: 'Bitcoin gains', observedAtMs: now - 100 }), now - 50, database);
    const first = service.analyze(configuration);
    now += NEWS_HOUR_MS;
    saveNewsObservation(newsFixture({ title: 'Bitcoin falls', observedAtMs: now - 10 }), now, database);
    const correction = service.analyze(configuration);
    expect(correction.analyses.find(a => a.title === 'Bitcoin falls')?.instruments[0]?.sentimentScore).toBe(-1);
    expect(service.featuresAsOf(BTC, NEWS_DAY_MS).find(f => f.cadence === 'daily')?.windows[1]?.sentimentMean).toBe(1);
    expect(first.run.inputObservationIds).not.toEqual(correction.run.inputObservationIds);
    expect(() => service.analyze({ ...configuration, reviewedAtMs: now }, { inputCutoffMs: NEWS_DAY_MS })).toThrow('cutoff');
    expect(() => service.featuresAsOf(BTC, now + 1)).toThrow('future');
  });
  it('marks historical reconstructions and excludes them from eligibility', () => {
    const database = db(); saveNewsObservation(newsFixture({ title: 'Bitcoin gains' }), 300, database);
    const service = new NewsIntelligenceService({ database, clock: { nowMs: () => NEWS_DAY_MS * 2 } });
    service.analyze(configuration, { inputCutoffMs: NEWS_DAY_MS });
    expect(service.featuresAsOf(BTC, NEWS_DAY_MS * 2)).toEqual([]);
    const row = database.prepare('SELECT reconstruction FROM news_feature_snapshots_v1').get();
    expect(row?.['reconstruction']).toBe(1);
  });
  it('pages over 250 records and fails atomically on a bound instead of truncating', () => {
    const database = db();
    for (let i = 0; i < 251; i++) saveNewsObservation(newsFixture({ title: `Bitcoin gains ${i}`,
      providerArticleId: `fixture-${i}`, url: `https://publisher.example/${i}` }), 300, database);
    const page = pageNewsObservationsAsOf(300, null, 250, database);
    expect(page.observations).toHaveLength(250); expect(page.nextCursor).not.toBeNull();
    expect(pageNewsObservationsAsOf(300, page.nextCursor, 250, database).observations).toHaveLength(1);
    const service = new NewsIntelligenceService({ database, clock: { nowMs: () => NEWS_HOUR_MS } });
    expect(() => service.analyze(configuration, { maxObservations: 250 })).toThrow('bound');
    expect(database.prepare('SELECT count(*) AS n FROM news_analysis_runs_v1').get()?.['n']).toBe(0);
    expect(service.analyze(configuration).analyses).toHaveLength(251);
  });
  it('rejects registry base-asset mismatch and retains missing mapping reasons', () => {
    const database = db(); database.prepare('UPDATE canonical_instruments SET base_asset=? WHERE product_id=?').run('WBTC', 'BTC-USD');
    const service = new NewsIntelligenceService({ database, clock: { nowMs: () => NEWS_HOUR_MS } });
    expect(() => service.analyze(configuration)).toThrow('base asset');
    database.prepare('DELETE FROM canonical_instruments').run();
    saveNewsObservation(newsFixture({ title: 'Bitcoin gains' }), 300, database);
    expect(service.analyze(configuration).analyses[0]?.resolutions[0]?.reason).toBe('missing_registry');
  });
  it('rolls back even when a late feature insert fails', () => {
    const database = db();
    const service = new NewsIntelligenceService({ database, clock: { nowMs: () => NEWS_HOUR_MS } });
    database.exec("CREATE TRIGGER fixture_reject_features BEFORE INSERT ON news_feature_snapshots_v1 BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    expect(() => service.analyze(configuration)).toThrow('fixture failure');
    expect(database.prepare('SELECT count(*) AS n FROM news_analysis_runs_v1').get()?.['n']).toBe(0);
  });
  it('rejects invalid references before writing a batch', () => {
    const database = db(), input = { inputCutoffMs: 300, configuration, registry, inputObservationIds: [] };
    const run = { schemaVersion: 1, algorithmVersion: 'news-intelligence-v1', ...input, id: newsAnalysisRunId(input),
      completedAtMs: 300, persistedAtMs: 300, availableAtMs: 300 } as const;
    expect(() => saveNewsIntelligenceBatch(run, [analysis()], [], [], database)).toThrow('references');
    expect(listNewsFeaturesAsOf(BTC, 300, 100, database)).toEqual([]);
  });
  it('does not read future quota completion as historical success', () => {
    const database = db(), scope = newsEvidenceHash('pool');
    database.prepare('INSERT INTO news_api_usage_v1 VALUES (?,?,?,?,?,?,?)').run('gdelt', scope, '1970-01-01', 72, 1, 1, 0);
    database.prepare('INSERT INTO news_request_attempts_v1 VALUES (?,?,?,?,?,?,?,?,?)').run('synthetic', 'gdelt', scope,
      '1970-01-01', 100, 'succeeded', 400, 200, 'ok');
    expect(readNewsCoverage(300, database)[0]).toMatchObject({ succeeded: 0, pending: 1 });
    expect(readNewsCoverage(400, database)[0]).toMatchObject({ succeeded: 1, pending: 0 });
  });
  it('keeps windows UTC-aligned, separates unknown from neutral, and requires a volume baseline', () => {
    const value = feature([analysis('Bitcoin statement')]);
    expect(value.windows[1]).toMatchObject({ articleCount: 1, sentimentMean: null, sentimentSampleCount: 0 });
    expect(value.coverageComplete).toBeNull(); expect(value.volumeZScore24h).toBeNull();
    expect(value.missingReasons).toContain('no_poll_evidence');
    const at = 32 * NEWS_DAY_MS;
    const baseline = Array.from({ length: 30 }, (_, i) => ({ ...value, id: newsEvidenceHash(i),
      decisionAtMs: (i + 1) * NEWS_DAY_MS, availableAtMs: (i + 1) * NEWS_DAY_MS + 1,
      windows: value.windows.map(w => ({ ...w, groupCount: i % 2 })) }));
    expect(feature([], baseline, at).volumeZScore24h).toBe(-1);
    expect(feature([], baseline.slice(1), at).volumeZScore24h).toBeNull();
    expect(feature([], baseline.map(s => ({ ...s, availableAtMs: at + 1 })), at).volumeZScore24h).toBeNull();
    expect(feature([], baseline.map(s => ({ ...s, windows: s.windows.map(w => ({ ...w, groupCount: 1 })) })), at).volumeZScore24h).toBeNull();
    expect(instrumentKey(value.instrument)).toBe('coinbase|spot|BTC-USD');
  });
});
