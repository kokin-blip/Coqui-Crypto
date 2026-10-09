import { instrumentKey, type InstrumentIdentity } from '../types/instrument.js';
import { eligibleNewsAnalysesAsOf } from './clusters.js';
import { newsEvidenceHash } from './intelligence.js';
import type { NewsClusterSnapshot, NewsFeatureSnapshot, NewsFeatureWindow, NewsObservationAnalysis, NewsInstrumentIdentity } from './intelligence-types.js';

export const NEWS_FEATURE_VERSION = 'news-features-v1' as const;
export const NEWS_HOUR_MS = 3_600_000;
export const NEWS_DAY_MS = 86_400_000;
function mean(values: readonly number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function featureWindow(instrument: InstrumentIdentity, decisionAtMs: number, windowMs: NewsFeatureWindow['windowMs'],
  analyses: readonly NewsObservationAnalysis[], clusters: readonly NewsClusterSnapshot[]): NewsFeatureWindow {
  const eligible = eligibleNewsAnalysesAsOf(analyses, decisionAtMs).filter(a =>
    a.instruments.some(i => instrumentKey(i.instrument) === instrumentKey(instrument)));
  const relevant = eligible.filter(a => a.firstAvailableAtMs > decisionAtMs - windowMs && a.firstAvailableAtMs <= decisionAtMs);
  const articles = new Set(relevant.map(a => a.articleId));
  const groups = clusters.filter(c => c.articleIds.some(id => articles.has(id)));
  const sentiment: number[] = [], providerSentiment: number[] = [];
  const eventCounts = { macro: 0, regulatory: 0, exchange: 0, security: 0, protocol: 0, market_structure: 0, other: 0 };
  for (const group of groups) {
    const members = relevant.filter(a => group.articleIds.includes(a.articleId));
    const values = members.flatMap(a => a.instruments.filter(i => instrumentKey(i.instrument) === instrumentKey(instrument)));
    const scores = [...new Set(values.map(i => i.sentimentScore).filter((s): s is number => s !== null))];
    // Conflicting copies do not become a falsely neutral group; unknown members add no weight.
    if (scores.length === 1) sentiment.push(scores[0]!);
    const raw = values.flatMap(i => i.providerEntities.map(e => e.entity.sentimentScore)).filter((s): s is number => s !== null);
    const providerMean = mean(raw); if (providerMean !== null) providerSentiment.push(providerMean);
    for (const label of new Set(members.map(a => a.eventLabel))) eventCounts[label]++;
  }
  return { windowMs, articleCount: articles.size, groupCount: groups.length,
    publisherCount: new Set(relevant.map(a => a.publisher)).size, sentimentMean: mean(sentiment),
    sentimentSampleCount: sentiment.length, providerSentimentMean: mean(providerSentiment),
    providerSentimentSampleCount: providerSentiment.length, eventCounts,
    dataAgeSeconds: eligible.length ? (decisionAtMs - Math.max(...eligible.map(a => a.availableAtMs))) / 1000 : null };
}
export function buildNewsFeatureSnapshot(input: {
  readonly runId: string; readonly instrument: NewsInstrumentIdentity; readonly cadence: 'hourly' | 'daily';
  readonly decisionAtMs: number; readonly availableAtMs: number; readonly analyses: readonly NewsObservationAnalysis[];
  readonly clusters: readonly NewsClusterSnapshot[]; readonly baseline: readonly NewsFeatureSnapshot[];
  readonly coverage: NewsFeatureSnapshot['coverage']; readonly reconstruction: boolean;
}): NewsFeatureSnapshot {
  const windows = ([NEWS_HOUR_MS, NEWS_DAY_MS] as const).map(window => featureWindow(input.instrument, input.decisionAtMs,
    window, input.analyses, input.clusters));
  const baseline = [...input.baseline].filter(s => s.cadence === 'daily' && s.featureVersion === NEWS_FEATURE_VERSION &&
    !s.reconstruction && s.availableAtMs <= input.decisionAtMs && s.decisionAtMs <= input.decisionAtMs - NEWS_DAY_MS &&
    instrumentKey(s.instrument) === instrumentKey(input.instrument)).sort((a, b) => b.decisionAtMs - a.decisionAtMs);
  const distinct = baseline.filter((s, i) => baseline.findIndex(other => other.decisionAtMs === s.decisionAtMs) === i).slice(0, 30);
  const counts = distinct.map(s => s.windows.find(w => w.windowMs === NEWS_DAY_MS)!.groupCount);
  const average = mean(counts), variance = average === null ? 0 : mean(counts.map(n => (n - average) ** 2))!;
  const volumeZScore24h = counts.length === 30 && variance > 0 ? (windows[1]!.groupCount - average!) / Math.sqrt(variance) : null;
  return { schemaVersion: 1, id: newsEvidenceHash({ runId: input.runId, instrument: input.instrument,
    cadence: input.cadence, decisionAtMs: input.decisionAtMs, version: NEWS_FEATURE_VERSION }), runId: input.runId,
    featureVersion: NEWS_FEATURE_VERSION, instrument: input.instrument, cadence: input.cadence,
    decisionAtMs: input.decisionAtMs, availableAtMs: input.availableAtMs,
    reconstruction: input.reconstruction, windows, volumeZScore24h,
    baselineSnapshotIds: distinct.map(s => s.id), clusterSnapshotIds: input.clusters.map(c => c.id), coverageComplete: null, coverage: input.coverage,
    missingReasons: ['first_page_coverage_unknown', ...(windows[1]!.articleCount ? [] : ['no_relevant_evidence']),
      ...(windows[1]!.sentimentSampleCount ? [] : ['no_known_sentiment']),
      ...(volumeZScore24h === null ? ['volume_baseline_unavailable'] : []),
      ...(input.coverage.length ? [] : ['no_poll_evidence'])] };
}
