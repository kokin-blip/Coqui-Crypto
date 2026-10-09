import { canonicalJson, instrumentKey, isNewsTimestamp, newsEvidenceHash, type CanonicalJsonValue,
  type NewsAnalysisRun, type NewsClusterSnapshot, type NewsFeatureSnapshot, type NewsIntelligenceConfiguration,
  type NewsObservationAnalysis, type NewsRegistryEvidence, type InstrumentIdentity } from '@coqui/core';
import { newsAnalysisRunSchema, newsClusterSnapshotSchema, newsFeatureSnapshotSchema,
  newsObservationAnalysisSchema } from '@coqui/contracts';
import { inTransaction, type Db } from '../sqlite/index.js';

interface EvidenceRow { evidence_json: string; content_hash: string }
function restore<T>(row: EvidenceRow, parse: (value: unknown) => T): T {
  const value: unknown = JSON.parse(row.evidence_json);
  if (newsEvidenceHash(value) !== row.content_hash) throw new Error('News intelligence evidence failed integrity validation.');
  return parse(value);
}
export function newsAnalysisRunId(run: Pick<NewsAnalysisRun, 'inputCutoffMs' | 'configuration' | 'registry' | 'inputObservationIds'>): string {
  return newsEvidenceHash({ algorithmVersion: 'news-intelligence-v1', ...run });
}
export function readNewsRegistryEvidence(configuration: NewsIntelligenceConfiguration, cutoff: number,
  database: Db): readonly NewsRegistryEvidence[] {
  const result: NewsRegistryEvidence[] = [];
  for (const entry of configuration.instruments) {
    const row = database.prepare(`SELECT name,base_asset,quote_asset,created_at,updated_at FROM canonical_instruments
      WHERE venue=? AND product_id=? AND product_type=? AND created_at<=? AND updated_at<=?`)
      .get(entry.instrument.venue, entry.instrument.productId, entry.instrument.productType, cutoff, cutoff) as
      { name: string; base_asset: string; quote_asset: string; created_at: number; updated_at: number } | undefined;
    if (!row) continue;
    if (row.base_asset.toUpperCase() !== entry.asset || row.quote_asset.toUpperCase() === entry.asset) {
      throw new Error('News instrument mapping does not match canonical base asset.');
    }
    result.push({ asset: entry.asset, instrument: entry.instrument, name: row.name, baseAsset: row.base_asset,
      quoteAsset: row.quote_asset, createdAtMs: row.created_at, updatedAtMs: row.updated_at });
  }
  return result;
}
export function newsArticleFirstAvailableAt(articleId: string, database: Db): number {
  const row = database.prepare('SELECT first_observed_at,persisted_at FROM news_articles_v1 WHERE id=?').get(articleId) as
    { first_observed_at: number; persisted_at: number } | undefined;
  if (!row) throw new Error('Missing news article identity.');
  return Math.max(row.first_observed_at, row.persisted_at);
}
export function readNewsAnalysisRun(id: string, database: Db): NewsAnalysisRun | null {
  const row = database.prepare('SELECT * FROM news_analysis_runs_v1 WHERE id=?').get(id) as
    (EvidenceRow & { input_cutoff_at: number; completed_at: number; persisted_at: number }) | undefined;
  if (!row) return null;
  const run = restore(row, value => newsAnalysisRunSchema.parse(value));
  if (run.id !== id || run.inputCutoffMs !== row.input_cutoff_at || run.completedAtMs !== row.completed_at ||
    run.persistedAtMs !== row.persisted_at || run.id !== newsAnalysisRunId({ inputCutoffMs: run.inputCutoffMs,
      configuration: run.configuration, registry: run.registry, inputObservationIds: run.inputObservationIds })) {
    throw new Error('News analysis run failed integrity validation.');
  }
  return run;
}
export function listNewsRunAnalyses(runId: string, database: Db): readonly NewsObservationAnalysis[] {
  return (database.prepare('SELECT * FROM news_observation_analyses_v1 WHERE run_id=? ORDER BY observation_id').all(runId) as unknown as
    EvidenceRow[]).map(row => restore(row, value => newsObservationAnalysisSchema.parse(value)));
}
export function listNewsRunClusters(runId: string, database: Db): readonly NewsClusterSnapshot[] {
  return (database.prepare('SELECT * FROM news_cluster_snapshots_v1 WHERE run_id=? ORDER BY id').all(runId) as unknown as
    EvidenceRow[]).map(row => restore(row, value => newsClusterSnapshotSchema.parse(value)));
}
export function listNewsFeaturesAsOf(instrument: InstrumentIdentity, cutoff: number, limit: number, database: Db): readonly NewsFeatureSnapshot[] {
  if (!isNewsTimestamp(cutoff) || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) throw new TypeError('Invalid news feature historical read.');
  const rows = database.prepare(`SELECT feature.* FROM news_feature_snapshots_v1 feature
    JOIN news_analysis_runs_v1 run ON run.id=feature.run_id WHERE instrument_key=? AND decision_at<=?
    AND available_at<=? AND run.persisted_at<=? AND reconstruction=0
    ORDER BY decision_at DESC,available_at DESC,id LIMIT ?`).all(instrumentKey(instrument), cutoff, cutoff, cutoff, limit) as unknown as
    (EvidenceRow & { id: string; run_id: string; instrument_key: string; cadence: string; decision_at: number; available_at: number })[];
  return rows.map(row => {
    const feature = restore(row, value => newsFeatureSnapshotSchema.parse(value));
    if (feature.id !== row.id || feature.runId !== row.run_id || instrumentKey(feature.instrument) !== row.instrument_key ||
      feature.cadence !== row.cadence || feature.decisionAtMs !== row.decision_at || feature.availableAtMs !== row.available_at || feature.reconstruction) {
      throw new Error('News feature failed integrity validation.');
    }
    const run = readNewsAnalysisRun(feature.runId, database);
    if (!run || run.availableAtMs !== feature.availableAtMs) throw new Error('News feature run failed integrity validation.');
    return feature;
  });
}
export function readNewsDailyBaseline(instrument: InstrumentIdentity, cutoff: number, database: Db): readonly NewsFeatureSnapshot[] {
  // At most one latest eligible revision per daily boundary; a bounded 30-day baseline.
  const rows = database.prepare(`SELECT feature.* FROM news_feature_snapshots_v1 feature
    WHERE instrument_key=? AND cadence='daily' AND decision_at<=? AND available_at<=? AND reconstruction=0
    AND id=(SELECT candidate.id FROM news_feature_snapshots_v1 candidate WHERE candidate.instrument_key=feature.instrument_key
      AND candidate.cadence='daily' AND candidate.decision_at=feature.decision_at AND candidate.available_at<=? AND candidate.reconstruction=0
      ORDER BY candidate.available_at DESC,candidate.id LIMIT 1) ORDER BY decision_at DESC LIMIT 30`)
    .all(instrumentKey(instrument), cutoff - 86_400_000, cutoff, cutoff) as unknown as EvidenceRow[];
  return rows.map(row => restore(row, value => newsFeatureSnapshotSchema.parse(value)));
}
export function readNewsCoverage(cutoff: number, database: Db): NewsFeatureSnapshot['coverage'] {
  // Terminal outcomes are eligible only when finalized by the historical cutoff.
  const rows = database.prepare(`SELECT provider,count(*) AS reserved,
    sum(CASE WHEN outcome='succeeded' AND completed_at<=? THEN 1 ELSE 0 END) AS succeeded,
    sum(CASE WHEN outcome='failed' AND completed_at<=? THEN 1 ELSE 0 END) AS failed
    FROM news_request_attempts_v1 WHERE reserved_at>? AND reserved_at<=? GROUP BY provider ORDER BY provider`)
    .all(cutoff, cutoff, Math.max(0, cutoff - 86_400_000), cutoff) as unknown as
    { provider: NewsObservationAnalysis['provider']; reserved: number; succeeded: number; failed: number }[];
  return rows.map(r => ({ ...r, pending: r.reserved - r.succeeded - r.failed }));
}
export function saveNewsIntelligenceBatch(runValue: NewsAnalysisRun, analysisValues: readonly NewsObservationAnalysis[],
  clusterValues: readonly NewsClusterSnapshot[], featureValues: readonly NewsFeatureSnapshot[], database: Db): boolean {
  if (analysisValues.length > 10_000 || clusterValues.length > 30_000 || featureValues.length > 6) {
    throw new Error('News intelligence output exceeds bound.');
  }
  const run = newsAnalysisRunSchema.parse(runValue);
  const analyses = analysisValues.map(value => newsObservationAnalysisSchema.parse(value));
  const clusters = clusterValues.map(value => newsClusterSnapshotSchema.parse(value));
  const features = featureValues.map(value => newsFeatureSnapshotSchema.parse(value));
  if (run.id !== newsAnalysisRunId({ inputCutoffMs: run.inputCutoffMs, configuration: run.configuration,
    registry: run.registry, inputObservationIds: run.inputObservationIds }) ||
    newsEvidenceHash(analyses.map(a => a.observationId).sort()) !== newsEvidenceHash([...run.inputObservationIds].sort()) ||
    new Set(analyses.map(a => a.observationId)).size !== analyses.length ||
    clusters.some(c => c.inputCutoffMs > run.inputCutoffMs || c.id !== newsEvidenceHash({ version: c.algorithmVersion,
      inputCutoffMs: c.inputCutoffMs, articleIds: c.articleIds, observationIds: c.observationIds }) ||
      c.observationIds.some(id => !analyses.some(a => a.observationId === id && a.availableAtMs <= c.inputCutoffMs && c.articleIds.includes(a.articleId))) ||
      new Set(c.articleIds).size !== c.articleIds.length || new Set(c.observationIds).size !== c.observationIds.length ||
      c.matches.some(m => !c.articleIds.includes(m.leftArticleId) || !c.articleIds.includes(m.rightArticleId))) ||
    features.some(f => f.clusterSnapshotIds.some(id => !clusters.some(c => c.id === id && c.inputCutoffMs === f.decisionAtMs))) ||
    features.some(f => f.id !== newsEvidenceHash({ runId: f.runId, instrument: f.instrument, cadence: f.cadence,
      decisionAtMs: f.decisionAtMs, version: f.featureVersion }) || f.runId !== run.id || f.decisionAtMs > run.inputCutoffMs ||
      f.availableAtMs !== run.availableAtMs || !run.registry.some(r =>
      instrumentKey(r.instrument) === instrumentKey(f.instrument)))) throw new Error('Invalid news intelligence batch references.');
  return inTransaction(database, () => {
    const prior = readNewsAnalysisRun(run.id, database);
    if (prior) return false;
    for (const analysis of analyses) {
      const row = database.prepare(`SELECT record.article_id,observation.provider_record_id,observation.observed_at,observation.persisted_at FROM news_observations_v1 observation
        JOIN news_provider_records_v1 record ON record.id=observation.provider_record_id WHERE observation.id=?`).get(analysis.observationId) as
        { article_id: string; provider_record_id: string; observed_at: number; persisted_at: number } | undefined;
      if (!row || row.article_id !== analysis.articleId || row.provider_record_id !== analysis.providerRecordId || row.observed_at !== analysis.observedAtMs || Math.max(row.observed_at, row.persisted_at) !== analysis.availableAtMs ||
        analysis.availableAtMs > run.inputCutoffMs) throw new Error('Invalid news analysis observation reference.');
    }
    database.prepare(`INSERT INTO news_analysis_runs_v1(id,input_cutoff_at,completed_at,persisted_at,content_hash,evidence_json)
      VALUES (?,?,?,?,?,?)`).run(run.id, run.inputCutoffMs, run.completedAtMs, run.persistedAtMs, newsEvidenceHash(run),
        canonicalJson(run as unknown as CanonicalJsonValue));
    for (const a of analyses) database.prepare('INSERT INTO news_observation_analyses_v1 VALUES (?,?,?,?)')
      .run(run.id, a.observationId, newsEvidenceHash(a), canonicalJson(a as unknown as CanonicalJsonValue));
    for (const c of clusters) database.prepare('INSERT INTO news_cluster_snapshots_v1 VALUES (?,?,?,?)')
      .run(run.id, c.id, newsEvidenceHash(c), canonicalJson(c as unknown as CanonicalJsonValue));
    for (const f of features) database.prepare('INSERT INTO news_feature_snapshots_v1 VALUES (?,?,?,?,?,?,?,?,?)')
      .run(f.id, run.id, instrumentKey(f.instrument), f.cadence, f.decisionAtMs, f.availableAtMs, f.reconstruction ? 1 : 0,
        newsEvidenceHash(f), canonicalJson(f as unknown as CanonicalJsonValue));
    return true;
  });
}
