import { analyzeNewsObservation, buildNewsFeatureSnapshot, clusterNewsAnalyses, NEWS_DAY_MS, NEWS_HOUR_MS,
  NEWS_INTELLIGENCE_VERSION, isNewsTimestamp, type Clock, type InstrumentIdentity, type NewsAnalysisRun,
  type NewsClusterSnapshot, type NewsFeatureSnapshot, type NewsObservationAnalysis, type StoredNewsObservation } from '@coqui/core';
import { newsIntelligenceConfigurationSchema } from '@coqui/contracts';
import { inTransaction, listNewsFeaturesAsOf, listNewsRunAnalyses, listNewsRunClusters, newsAnalysisRunId,
  newsArticleFirstAvailableAt, pageNewsObservationRevisionsAsOf, readNewsAnalysisRun, readNewsCoverage, readNewsDailyBaseline,
  readNewsRegistryEvidence, saveNewsIntelligenceBatch, type Db } from '@coqui/storage';

export interface NewsIntelligenceBatchResult {
  readonly inserted: boolean;
  readonly run: NewsAnalysisRun;
  readonly analyses: readonly NewsObservationAnalysis[];
  readonly clusters: readonly NewsClusterSnapshot[];
  readonly unresolvedCandidateCount: number;
}
/** Explicit internal research work only. No HTTP, timers, research triggers or trading authority. */
export class NewsIntelligenceService {
  constructor(private readonly input: { readonly database: Db; readonly clock: Clock }) {}

  analyze(configurationValue: unknown, options: { readonly inputCutoffMs?: number; readonly maxObservations?: number } = {}): NewsIntelligenceBatchResult {
    const configuration = newsIntelligenceConfigurationSchema.parse(configurationValue);
    const startedAtMs = this.input.clock.nowMs(), cutoff = options.inputCutoffMs ?? startedAtMs;
    const max = options.maxObservations ?? 10_000;
    if (!isNewsTimestamp(cutoff) || cutoff > startedAtMs || configuration.reviewedAtMs > cutoff ||
      !Number.isSafeInteger(max) || max < 1 || max > 10_000) throw new TypeError('Invalid news analysis cutoff or bound.');
    return inTransaction(this.input.database, () => {
      const registry = readNewsRegistryEvidence(configuration, cutoff, this.input.database);
      const observations: StoredNewsObservation[] = [];
      let cursor: string | null = null;
      do {
        const page = pageNewsObservationRevisionsAsOf(cutoff, cursor, 250, this.input.database);
        observations.push(...page.observations);
        if (observations.length > max) throw new Error('News analysis input exceeds bound; no truncated result was saved.');
        cursor = page.nextCursor;
      } while (cursor !== null);
      const inputObservationIds = observations.map(o => o.observationId).sort();
      const identity = { inputCutoffMs: cutoff, configuration, registry, inputObservationIds };
      const id = newsAnalysisRunId(identity), prior = readNewsAnalysisRun(id, this.input.database);
      if (prior) return this.result(false, prior, listNewsRunAnalyses(id, this.input.database), listNewsRunClusters(id, this.input.database));
      const analyses = observations.map(o => analyzeNewsObservation(o, configuration, registry,
        newsArticleFirstAvailableAt(o.articleId, this.input.database)));
      const clusters = [...clusterNewsAnalyses(analyses, cutoff)];
      const completedAtMs = this.input.clock.nowMs();
      if (completedAtMs < startedAtMs) throw new Error('News analysis clock moved backwards.');
      const persistedAtMs = this.input.clock.nowMs();
      const run: NewsAnalysisRun = { schemaVersion: 1, id, algorithmVersion: NEWS_INTELLIGENCE_VERSION,
        ...identity, completedAtMs, persistedAtMs, availableAtMs: persistedAtMs };
      const features: NewsFeatureSnapshot[] = [];
      for (const entry of registry) for (const cadence of ['hourly', 'daily'] as const) {
        const width = cadence === 'hourly' ? NEWS_HOUR_MS : NEWS_DAY_MS;
        const decisionAtMs = Math.floor(cutoff / width) * width;
        const boundaryClusters = clusterNewsAnalyses(analyses, decisionAtMs);
        for (const cluster of boundaryClusters) if (!clusters.some(c => c.id === cluster.id)) clusters.push(cluster);
        features.push(buildNewsFeatureSnapshot({ runId: id, instrument: entry.instrument, cadence, decisionAtMs,
          availableAtMs: persistedAtMs, analyses, clusters: boundaryClusters, baseline: readNewsDailyBaseline(entry.instrument, decisionAtMs, this.input.database),
          coverage: readNewsCoverage(decisionAtMs, this.input.database), reconstruction: cutoff < startedAtMs }));
      }
      const inserted = saveNewsIntelligenceBatch(run, analyses, clusters, features, this.input.database);
      return this.result(inserted, run, analyses, clusters);
    });
  }

  featuresAsOf(instrument: InstrumentIdentity, cutoff: number, limit = 100): readonly NewsFeatureSnapshot[] {
    if (cutoff > this.input.clock.nowMs()) throw new TypeError('News feature cutoff is in the future.');
    return listNewsFeaturesAsOf(instrument, cutoff, limit, this.input.database);
  }
  private result(inserted: boolean, run: NewsAnalysisRun, analyses: readonly NewsObservationAnalysis[],
    clusters: readonly NewsClusterSnapshot[]): NewsIntelligenceBatchResult {
    return { inserted, run, analyses, clusters,
      unresolvedCandidateCount: analyses.reduce((count, a) => count + a.resolutions.filter(r => r.status === 'unresolved').length, 0) };
  }
}
