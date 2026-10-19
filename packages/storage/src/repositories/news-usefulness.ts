import { newsFeatureSnapshotSchema } from '@coqui/contracts';
import { eligibleNewsAnalysesAsOf, instrumentKey, NEWS_DAY_MS, newsEvidenceHash, type NewsProviderId } from '@coqui/core';
import type { Db } from '../sqlite/index.js';
import { listNewsRunAnalyses, listNewsRunClusters, readNewsAnalysisRun } from './news-intelligence.js';

/** Latest prospective feature only; first-page coverage and predictive value remain unproved. */
export function readNewsUsefulness(asOfMs: number, db: Db) {
  const row = db.prepare(`SELECT f.evidence_json,f.content_hash FROM news_feature_snapshots_v1 f
    JOIN news_analysis_runs_v1 r ON r.id=f.run_id WHERE f.reconstruction=0 AND f.available_at<=?
    AND r.persisted_at<=? ORDER BY f.available_at DESC,f.decision_at DESC,f.id LIMIT 1`).get(asOfMs,asOfMs) as
    { evidence_json:string; content_hash:string } | undefined;
  const empty = { lastEligibleFeatureAtMs: null, observationAnalysisLagMs: null, featureId: null,
    uniqueStories: null, missingReasons: ['prospective_feature_not_observed'], contribution: [] };
  if (!row) return empty;
  const feature = newsFeatureSnapshotSchema.parse(JSON.parse(row.evidence_json));
  if (newsEvidenceHash(feature)!==row.content_hash || feature.reconstruction || feature.availableAtMs>asOfMs) throw new Error('news_feature_integrity');
  const run = readNewsAnalysisRun(feature.runId,db);
  if (!run || run.persistedAtMs!==feature.availableAtMs) throw new Error('news_feature_run_integrity');
  const analyses = listNewsRunAnalyses(run.id,db);
  const ids = new Set(feature.clusterSnapshotIds);
  const clusters = listNewsRunClusters(run.id,db).filter(c=>ids.has(c.id));
  if (clusters.length!==feature.clusterSnapshotIds.length) throw new Error('news_feature_cluster_integrity');
  const relevant = eligibleNewsAnalysesAsOf(analyses,feature.decisionAtMs).filter(a=>
    a.firstAvailableAtMs>feature.decisionAtMs-NEWS_DAY_MS && a.instruments.some(i=>instrumentKey(i.instrument)===instrumentKey(feature.instrument)));
  const byArticle = new Map<string,Set<NewsProviderId>>();
  for(const analysis of relevant){const providers=byArticle.get(analysis.articleId)??new Set<NewsProviderId>();providers.add(analysis.provider);byArticle.set(analysis.articleId,providers);}
  const groups = clusters.map(cluster=>new Set(cluster.articleIds.flatMap(id=>[...(byArticle.get(id)??[])]))).filter(group=>group.size>0);
  if(groups.length!==feature.windows[1]?.groupCount) throw new Error('news_feature_contribution_mismatch');
  return { lastEligibleFeatureAtMs: feature.availableAtMs, observationAnalysisLagMs: run.persistedAtMs-run.inputCutoffMs,
    featureId: feature.id, uniqueStories: groups.length, missingReasons: [...feature.missingReasons],
    contribution: (['gdelt','marketaux','currents'] as const).map((provider:NewsProviderId)=>({provider,
      contributingStories:groups.filter(group=>group.has(provider)).length,
      exclusiveStories:groups.filter(group=>group.size===1&&group.has(provider)).length})) };
}
