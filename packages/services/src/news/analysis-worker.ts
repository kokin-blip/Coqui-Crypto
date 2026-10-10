import { parentPort, workerData } from 'node:worker_threads';
import { buildNewsFeatureSnapshot, clusterNewsAnalyses, NEWS_HOUR_MS, NEWS_DAY_MS, type NewsFeatureSnapshot,
  type NewsObservationAnalysis, type NewsRegistryEvidence } from '@coqui/core';
const input = workerData as { analyses: readonly NewsObservationAnalysis[]; cutoff: number; registry: readonly NewsRegistryEvidence[];
  runId: string; baselines: readonly (readonly NewsFeatureSnapshot[])[]; coverage: { readonly hourly: NewsFeatureSnapshot['coverage']; readonly daily: NewsFeatureSnapshot['coverage'] } };
try {
  const clusters = [...clusterNewsAnalyses(input.analyses, input.cutoff)], features: NewsFeatureSnapshot[] = [];
  input.registry.forEach((entry, index) => {
    for (const cadence of ['hourly', 'daily'] as const) {
      const width = cadence === 'hourly' ? NEWS_HOUR_MS : NEWS_DAY_MS, decisionAtMs = Math.floor(input.cutoff / width) * width;
      const boundary = clusterNewsAnalyses(input.analyses, decisionAtMs);
      for (const c of boundary) if (!clusters.some(existing => existing.id === c.id)) clusters.push(c);
      features.push(buildNewsFeatureSnapshot({ featureVersion: 'news-features-window-v2', runId: input.runId,
        instrument: entry.instrument, cadence, decisionAtMs, availableAtMs: input.cutoff, analyses: input.analyses,
        clusters: boundary, baseline: input.baselines[index]!, coverage: input.coverage[cadence], reconstruction: false }));
    }
  });
  parentPort?.postMessage({ clusters, features });
} catch { parentPort?.postMessage({ failed: true }); }
