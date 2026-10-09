import { Worker } from 'node:worker_threads';
import { analyzeNewsObservation, buildNewsFeatureSnapshot, clusterNewsAnalyses, NEWS_DAY_MS, NEWS_HOUR_MS,
  NEWS_INTELLIGENCE_VERSION, newsEvidenceHash, isNewsTimestamp, type Clock, type InstrumentIdentity, type NewsAnalysisRun,
  type NewsClusterSnapshot, type NewsFeatureSnapshot, type NewsObservationAnalysis, type StoredNewsObservation } from '@coqui/core';
import { newsIntelligenceConfigurationSchema, newsClusterSnapshotSchema, newsFeatureSnapshotSchema } from '@coqui/contracts';
import { inTransaction, listNewsFeaturesAsOf, listNewsRunAnalyses, listNewsRunClusters, newsAnalysisRunId,
  newsArticleFirstAvailableAt, pageNewsObservationRevisionsAsOf, readNewsAnalysisRun, readNewsCoverage, readNewsDailyBaseline,
  readNewsRegistryEvidence, saveNewsIntelligenceBatch, pendingNewsAnalysisIds, readNewsObservation, saveNewsAnalysisChunk, readNewsWindowAnalyses, type Db } from '@coqui/storage';

export interface NewsIntelligenceBatchResult {
  readonly inserted: boolean;
  readonly run: NewsAnalysisRun;
  readonly analyses: readonly NewsObservationAnalysis[];
  readonly clusters: readonly NewsClusterSnapshot[];
  readonly unresolvedCandidateCount: number;
}
/** Explicit internal research work only. No HTTP, timers, research triggers or trading authority. */
export class NewsIntelligenceService {
  constructor(private readonly input: { readonly database: Db; readonly clock: Clock; readonly workerUrl?: URL }) {}

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

  /** One short, atomic chunk per call; completed chunks survive restarts and ownership loss. */
  advance(configurationValue: unknown): { readonly state: 'processing' | 'complete'; readonly processed: number; readonly result?: NewsIntelligenceBatchResult } {
    const configuration = newsIntelligenceConfigurationSchema.parse(configurationValue);
    const cutoff = this.input.clock.nowMs();
    if (configuration.reviewedAtMs > cutoff) throw new TypeError('Mapping review is not yet available.');
    const registry = readNewsRegistryEvidence(configuration, cutoff, this.input.database);
    const configurationHash = newsEvidenceHash({ configuration, registry, algorithmVersion: NEWS_INTELLIGENCE_VERSION });
    const ids = pendingNewsAnalysisIds(configurationHash, cutoff, this.input.database);
    if (ids.length) {
      const analyses = ids.map(id => {
        const o = readNewsObservation(id, this.input.database);
        return analyzeNewsObservation(o, configuration, registry, newsArticleFirstAvailableAt(o.articleId, this.input.database));
      });
      saveNewsAnalysisChunk(configurationHash, analyses, this.input.clock.nowMs(), this.input.clock.nowMs(), this.input.database);
      return { state: 'processing', processed: ids.length };
    }
    // Two UTC days include the daily trailing window and one day of syndication context.
    const inputWindowStartMs = Math.max(0, Math.floor(cutoff / NEWS_DAY_MS) * NEWS_DAY_MS - 2 * NEWS_DAY_MS);
    const { analyses, chunkIds } = readNewsWindowAnalyses(configurationHash, cutoff, inputWindowStartMs, this.input.database);
    const identity = { inputCutoffMs: cutoff, inputWindowStartMs, configuration, registry,
      inputObservationIds: analyses.map(a => a.observationId).sort(), chunkIds };
    const id = newsAnalysisRunId(identity);
    const prior = readNewsAnalysisRun(id, this.input.database);
    if (prior) return { state: 'complete', processed: 0, result: this.result(false, prior, listNewsRunAnalyses(id, this.input.database), listNewsRunClusters(id, this.input.database)) };
    const clusters = [...clusterNewsAnalyses(analyses, cutoff)];
    const features: NewsFeatureSnapshot[] = [];
    for (const entry of registry) for (const cadence of ['hourly', 'daily'] as const) {
      const decisionAtMs = Math.floor(cutoff / (cadence === 'hourly' ? NEWS_HOUR_MS : NEWS_DAY_MS)) * (cadence === 'hourly' ? NEWS_HOUR_MS : NEWS_DAY_MS);
      const boundary = clusterNewsAnalyses(analyses, decisionAtMs);
      for (const c of boundary) if (!clusters.some(existing => existing.id === c.id)) clusters.push(c);
      features.push(buildNewsFeatureSnapshot({ featureVersion: 'news-features-window-v2', runId: id, instrument: entry.instrument,
        cadence, decisionAtMs, availableAtMs: cutoff, analyses, clusters: boundary,
        baseline: readNewsDailyBaseline(entry.instrument, decisionAtMs, this.input.database, 'news-features-window-v2'),
        coverage: readNewsCoverage(decisionAtMs, this.input.database), reconstruction: false }));
    }
    const completedAtMs = this.input.clock.nowMs();
    return inTransaction(this.input.database, () => {
      const persistedAtMs = this.input.clock.nowMs();
      const run: NewsAnalysisRun = { schemaVersion: 1, algorithmVersion: 'news-intelligence-window-v2', id, ...identity,
        completedAtMs, persistedAtMs, availableAtMs: persistedAtMs };
      const inserted = saveNewsIntelligenceBatch(run, analyses, clusters, features.map(f => ({ ...f, availableAtMs: persistedAtMs })), this.input.database);
      return { state: 'complete' as const, processed: 0, result: this.result(inserted, run, analyses, clusters) };
    });
  }

  /** Host computation runs off-thread; only validated, still-owned completions may persist. */
  async advanceAsync(configurationValue: unknown, signal: AbortSignal, canPersist: () => boolean): Promise<{ readonly state: 'processing' | 'complete' }> {
    if (signal.aborted || !canPersist()) throw new Error('News analysis ownership unavailable.');
    const configuration = newsIntelligenceConfigurationSchema.parse(configurationValue), cutoff = this.input.clock.nowMs();
    if (configuration.reviewedAtMs > cutoff) throw new TypeError('Mapping review is not available.');
    const registry = readNewsRegistryEvidence(configuration, cutoff, this.input.database);
    if (registry.length !== configuration.instruments.length) throw new Error('Reviewed registry identities are missing.');
    const configurationHash = newsEvidenceHash({ configuration, registry, algorithmVersion: NEWS_INTELLIGENCE_VERSION });
    if (pendingNewsAnalysisIds(configurationHash, cutoff, this.input.database).length) return inTransaction(this.input.database, () => {
      if (signal.aborted || !canPersist()) throw new Error('News analysis ownership lost.');
      if (!pendingNewsAnalysisIds(configurationHash, cutoff, this.input.database).length) return { state: 'processing' as const };
      return this.advance(configuration);
    });
    const inputWindowStartMs = Math.max(0, Math.floor(cutoff / NEWS_DAY_MS) * NEWS_DAY_MS - 2 * NEWS_DAY_MS);
    const { analyses, chunkIds } = readNewsWindowAnalyses(configurationHash, cutoff, inputWindowStartMs, this.input.database);
    const identity = { inputCutoffMs: cutoff, inputWindowStartMs, configuration, registry, inputObservationIds: analyses.map(a => a.observationId).sort(), chunkIds };
    const id = newsAnalysisRunId(identity);
    const baselines = registry.map(r => readNewsDailyBaseline(r.instrument, cutoff, this.input.database, 'news-features-window-v2'));
    const coverage = { hourly: readNewsCoverage(Math.floor(cutoff / NEWS_HOUR_MS) * NEWS_HOUR_MS, this.input.database),
      daily: readNewsCoverage(Math.floor(cutoff / NEWS_DAY_MS) * NEWS_DAY_MS, this.input.database) };
    const worker = new Worker(this.input.workerUrl ?? new URL('./analysis-worker.js', import.meta.url), { workerData: { analyses, registry, cutoff, runId: id, baselines, coverage },
      execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16 } });
    const output: unknown = await new Promise((resolve, reject) => {
      let settled = false;
      const stop = () => { void worker.terminate(); finish(() => reject(new Error('News analysis aborted.'))); };
      signal.addEventListener('abort', stop, { once: true });
      const finish = (fn: () => void) => { if (settled) return; settled = true; signal.removeEventListener('abort', stop); clearTimeout(timeout); fn(); };
      const timeout = setTimeout(() => { void worker.terminate(); finish(() => reject(new Error('News analysis worker exceeded time bound.'))); }, 60_000);
      worker.once('message', value => finish(() => resolve(value)));
      worker.once('error', () => finish(() => reject(new Error('News analysis worker failed.'))));
      worker.once('exit', () => finish(() => reject(new Error('News analysis worker stopped before delivering a result.'))));
    }).finally(() => { void worker.terminate(); });
    if (signal.aborted || !canPersist()) throw new Error('News analysis ownership lost.');
    const result = output as { clusters?: unknown[]; features?: unknown[] };
    if (!Array.isArray(result?.clusters) || !Array.isArray(result.features) || result.clusters.length > 60_000 || result.features.length > 6) throw new Error('Invalid worker output.');
    const completedAtMs = this.input.clock.nowMs();
    const clusters = result.clusters.map(c => newsClusterSnapshotSchema.parse(c));
    const features = result.features.map(f => newsFeatureSnapshotSchema.parse(f));
    inTransaction(this.input.database, () => {
      if (signal.aborted || !canPersist()) throw new Error('News analysis ownership lost.');
      const persistedAtMs = this.input.clock.nowMs();
      const run: NewsAnalysisRun = { schemaVersion: 1, algorithmVersion: 'news-intelligence-window-v2', id, ...identity, completedAtMs, persistedAtMs, availableAtMs: persistedAtMs };
      saveNewsIntelligenceBatch(run, analyses, clusters, features.map(f => ({ ...f, availableAtMs: persistedAtMs })), this.input.database);
    });
    return { state: 'complete' };
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
