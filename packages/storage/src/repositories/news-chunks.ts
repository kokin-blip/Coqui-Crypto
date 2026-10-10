import { canonicalJson, newsEvidenceHash, isNewsTimestamp, type CanonicalJsonValue, type NewsObservationAnalysis } from '@coqui/core';
import { newsObservationAnalysisSchema, newsAnalysisChunkSchema } from '@coqui/contracts';
import { inTransaction, type Db } from '../sqlite/index.js';

function validate(hash: string, cutoff: number): void {
  if (!/^[a-f0-9]{64}$/u.test(hash) || !isNewsTimestamp(cutoff)) throw new TypeError('Invalid analysis chunk input.');
}
export function pendingNewsAnalysisIds(configurationHash: string, cutoff: number, database: Db): readonly string[] {
  validate(configurationHash, cutoff);
  return (database.prepare(`SELECT id FROM news_observations_v1 o WHERE observed_at<=? AND persisted_at<=?
    AND NOT EXISTS(SELECT 1 FROM news_cached_analyses_v1 c WHERE c.configuration_hash=? AND c.observation_id=o.id)
    ORDER BY o.persisted_at,o.id LIMIT 250`).all(cutoff, cutoff, configurationHash) as unknown as { id: string }[]).map(r => r.id);
}
export function saveNewsAnalysisChunk(configurationHash: string, values: readonly NewsObservationAnalysis[],
  completedAtMs: number, persistedAtMs: number, database: Db): string {
  validate(configurationHash, completedAtMs);
  if (!isNewsTimestamp(persistedAtMs) || persistedAtMs < completedAtMs || values.length < 1 || values.length > 250) throw new TypeError('Invalid chunk bounds.');
  const analyses = values.map(a => newsObservationAnalysisSchema.parse(a));
  if (analyses.some(a => a.availableAtMs > completedAtMs) || new Set(analyses.map(a => a.observationId)).size !== analyses.length) throw new TypeError('Invalid chunk observations.');
  const identity = { version: 'news-analysis-chunk-v1', configurationHash, observationIds: analyses.map(a => a.observationId).sort() };
  const id = newsEvidenceHash(identity);
  return inTransaction(database, () => {
    if (database.prepare('SELECT id FROM news_analysis_chunks_v1 WHERE id=?').get(id)) return id;
    const evidence = newsAnalysisChunkSchema.parse({ ...identity, completedAtMs, persistedAtMs });
    database.prepare('INSERT INTO news_analysis_chunks_v1 VALUES (?,?,?,?,?,?)').run(id, configurationHash,
      completedAtMs, persistedAtMs, newsEvidenceHash(evidence), canonicalJson(evidence as CanonicalJsonValue));
    for (const a of analyses) {
      const original = database.prepare(`SELECT o.observed_at,o.persisted_at,r.article_id FROM news_observations_v1 o
        JOIN news_provider_records_v1 r ON r.id=o.provider_record_id WHERE o.id=?`).get(a.observationId) as { observed_at: number; persisted_at: number; article_id: string } | undefined;
      if (!original || original.observed_at !== a.observedAtMs || Math.max(original.observed_at, original.persisted_at) !== a.availableAtMs || original.article_id !== a.articleId) throw new Error('Invalid cached observation reference.');
      database.prepare('INSERT INTO news_cached_analyses_v1 VALUES (?,?,?,?,?)').run(configurationHash,
        a.observationId, id, newsEvidenceHash(a), canonicalJson(a as unknown as CanonicalJsonValue));
    }
    return id;
  });
}
export function readNewsWindowAnalyses(configurationHash: string, cutoff: number, start: number, database: Db): {
  readonly analyses: readonly NewsObservationAnalysis[]; readonly chunkIds: readonly string[];
} {
  validate(configurationHash, cutoff);
  if (!isNewsTimestamp(start) || start > cutoff) throw new TypeError('Invalid analysis window.');
  const rows = database.prepare(`SELECT c.*,chunk.evidence_json AS chunk_json,chunk.content_hash AS chunk_hash FROM news_cached_analyses_v1 c
    JOIN news_observations_v1 o ON o.id=c.observation_id JOIN news_provider_records_v1 r ON r.id=o.provider_record_id
    JOIN news_articles_v1 a ON a.id=r.article_id JOIN news_analysis_chunks_v1 chunk ON chunk.id=c.chunk_id
    WHERE c.configuration_hash=? AND o.observed_at<=? AND o.persisted_at<=? AND chunk.persisted_at<=?
    AND max(a.first_observed_at,a.persisted_at)>? ORDER BY o.id LIMIT 20001`)
    .all(configurationHash, cutoff, cutoff, cutoff, start) as unknown as { evidence_json: string; content_hash: string; chunk_id: string; chunk_json: string; chunk_hash: string }[];
  if (rows.length > 20_000) throw new Error('News active window exceeds bound; no truncated feature was saved.');
  return { analyses: rows.map(row => {
    const chunk = newsAnalysisChunkSchema.parse(JSON.parse(row.chunk_json));
    if (newsEvidenceHash(chunk) !== row.chunk_hash || newsEvidenceHash({ version: chunk.version, configurationHash: chunk.configurationHash, observationIds: chunk.observationIds }) !== row.chunk_id || chunk.configurationHash !== configurationHash) throw new Error('News chunk integrity failure.');
    const value: unknown = JSON.parse(row.evidence_json);
    if (newsEvidenceHash(value) !== row.content_hash) throw new Error('News analysis cache integrity failure.');
    const analysis = newsObservationAnalysisSchema.parse(value);
    if (!chunk.observationIds.includes(analysis.observationId)) throw new Error('News chunk reference failure.');
    return analysis;
  }), chunkIds: [...new Set(rows.map(r => r.chunk_id))].sort() };
}
