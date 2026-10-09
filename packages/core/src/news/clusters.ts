import { newsEvidenceHash } from './intelligence.js';
import type { NewsClusterMatch, NewsClusterSnapshot, NewsObservationAnalysis } from './intelligence-types.js';

const DAY = 86_400_000;
export function normalizeNewsText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function similarity(left: string, right: string): number {
  const a = new Set(normalizeNewsText(left).split(' ').filter(Boolean));
  const b = new Set(normalizeNewsText(right).split(' ').filter(Boolean));
  const union = new Set([...a, ...b]);
  return union.size ? [...a].filter(token => b.has(token)).length / union.size : 0;
}
/** Conservative metadata syndication evidence; related events alone cannot match. */
export function newsSyndicationMatch(left: NewsObservationAnalysis, right: NewsObservationAnalysis): NewsClusterMatch | null {
  if (Math.abs(left.firstAvailableAtMs - right.firstAvailableAtMs) > DAY) return null;
  const a = normalizeNewsText(left.title), b = normalizeNewsText(right.title);
  if (a && a === b) return { leftArticleId: left.articleId, rightArticleId: right.articleId, kind: 'exact_title', similarity: 1 };
  const assets = left.instruments.map(i => i.asset);
  if (!right.instruments.some(i => assets.includes(i.asset)) || a.split(' ').length < 6 || b.split(' ').length < 6) return null;
  const score = similarity(a, b);
  // Where both descriptions exist, require supporting textual similarity as well.
  if (score < 0.85 || (left.description && right.description && similarity(left.description, right.description) < 0.5)) return null;
  return { leftArticleId: left.articleId, rightArticleId: right.articleId, kind: 'similar_title', similarity: score };
}
/** Mirrors observation eligibility and revision ordering in operational storage. */
export function eligibleNewsAnalysesAsOf(analyses: readonly NewsObservationAnalysis[], cutoff: number): readonly NewsObservationAnalysis[] {
  const records = new Map<string, NewsObservationAnalysis>();
  for (const value of [...analyses].filter(a => a.availableAtMs <= cutoff).sort((a, b) =>
    b.observedAtMs - a.observedAtMs || b.availableAtMs - a.availableAtMs || b.observationId.localeCompare(a.observationId))) {
    if (!records.has(value.providerRecordId)) records.set(value.providerRecordId, value);
  }
  return [...records.values()];
}
export function clusterNewsAnalyses(analyses: readonly NewsObservationAnalysis[],
  inputCutoffMs = Math.max(0, ...analyses.map(a => a.availableAtMs))): readonly NewsClusterSnapshot[] {
  analyses = eligibleNewsAnalysesAsOf(analyses, inputCutoffMs);
  const byArticle = new Map<string, NewsObservationAnalysis[]>();
  for (const analysis of analyses) byArticle.set(analysis.articleId, [...(byArticle.get(analysis.articleId) ?? []), analysis]);
  const representatives = [...byArticle.values()].map(values => [...values].sort((a, b) =>
    b.availableAtMs - a.availableAtMs || a.observationId.localeCompare(b.observationId))[0]!);
  representatives.sort((a, b) => a.articleId.localeCompare(b.articleId));
  const groups: NewsObservationAnalysis[][] = [];
  for (const value of representatives) {
    const group = groups.find(existing => existing.every(member => newsSyndicationMatch(member, value) !== null));
    if (group) {
      if (group.length * (group.length + 1) / 2 > 50_000) throw new Error('News syndication pair evidence exceeds bound.');
      group.push(value);
    } else groups.push([value]);
  }
  return groups.map(group => {
    const articleIds = group.map(a => a.articleId).sort();
    const members = articleIds.flatMap(id => byArticle.get(id)!);
    const observationIds = members.map(a => a.observationId).sort();
    const matches: NewsClusterMatch[] = [];
    group.forEach((left, index) => group.slice(index + 1).forEach(right => matches.push(newsSyndicationMatch(left, right)!)));
    return { schemaVersion: 1, algorithmVersion: 'news-syndication-v1', inputCutoffMs,
      id: newsEvidenceHash({ version: 'news-syndication-v1', inputCutoffMs, articleIds, observationIds }), articleIds,
      observationIds, publishers: [...new Set(members.map(a => a.publisher))].sort(), matches };
  });
}
