import { newsEvidenceHash, type Clock } from '@coqui/core';
import type { ChannelHandlers } from './dispatch.js';
import { newsObservationAnalysisSchema } from '@coqui/contracts';
import { newsAnalysisEnabled, readNewsAnalysisConfiguration, readNewsHostConfiguration, saveNewsAnalysisEnabled } from '@coqui/services';
import { listNewsObservationsAsOf, readNewsObservation, readNewsCoverage, listNewsFeaturesAsOf, readNewsRegistryEvidence, getSetting, type Db } from '@coqui/storage';
export function createNewsHandlers(profileId: string, database: Db, clock: Clock): ChannelHandlers {
  const cutoff = (asOf: number | null) => { const value = asOf ?? clock.nowMs(); if (value > clock.nowMs()) throw new TypeError('Future news cutoff.'); return value; };
  return {
    'news.timeline': (p: { readonly asOfMs: number | null; readonly limit: number }) => {
      const asOfMs = cutoff(p.asOfMs);
      return { ok: true, value: { asOfMs, observations: listNewsObservationsAsOf(asOfMs, p.limit, database).map(o =>
        ({ id: o.observationId, articleId: o.articleId, observation: o.observation, availableAtMs: o.availableAtMs })) } };
    },
    'news.detail': (p: { readonly observationId: string; readonly asOfMs: number | null }) => {
      const asOf = cutoff(p.asOfMs), observation = readNewsObservation(p.observationId, database);
      if (observation.availableAtMs > asOf) return { ok: false, issues: [{ code: 'news_unavailable' }] };
      const rows = database.prepare(`SELECT a.evidence_json,a.content_hash FROM news_observation_analyses_v1 a JOIN news_analysis_runs_v1 r ON r.id=a.run_id
        WHERE a.observation_id=? AND r.persisted_at<=? ORDER BY r.persisted_at DESC LIMIT 100`).all(p.observationId, asOf) as unknown as { evidence_json: string; content_hash: string }[];
      const analyses = rows.map(r => {
        const value = newsObservationAnalysisSchema.parse(JSON.parse(r.evidence_json));
        if (newsEvidenceHash(value) !== r.content_hash) throw new Error('News analysis integrity failure.');
        return value;
      });
      const instruments = analyses[0]?.instruments ?? [];
      return { ok: true, value: { analyses, features: instruments.flatMap(i => listNewsFeaturesAsOf(i.instrument, asOf, 2, database)) } };
    },
    'news.health': () => {
      const asOfMs = clock.nowMs(), mapping = readNewsAnalysisConfiguration(database), configuration = readNewsHostConfiguration(database);
      const coverage = readNewsCoverage(asOfMs, database);
      const latest = database.prepare('SELECT max(persisted_at) AS at FROM news_analysis_runs_v1 WHERE persisted_at<=?').get(asOfMs) as { at: number | null };
      const mappingReady = mapping !== null && readNewsRegistryEvidence(mapping, asOfMs, database).length === mapping.instruments.length && mapping.reviewedAtMs <= asOfMs;
      const studyStatus = getSetting('news_study_status_v1', database) ?? 'not_run';
      if (!['not_run', 'insufficient_evidence', 'evaluated'].includes(studyStatus)) throw new TypeError('Invalid study status.');
      return { ok: true, value: { asOfMs, mainProfile: profileId === 'main', collectionEnabled: profileId === 'main' && configuration.gdeltEnabled,
        analysisEnabled: newsAnalysisEnabled(database), mappingReady, latestAnalysisAtMs: latest.at, coverageComplete: null, studyStatus,
        providers: (['gdelt', 'marketaux', 'currents'] as const).map(provider => {
          const c = coverage.find(c => c.provider === provider);
          const last = database.prepare('SELECT max(completed_at) AS at FROM news_request_attempts_v1 WHERE provider=? AND completed_at<=?').get(provider, asOfMs) as { at: number | null };
          return { provider, enabled: profileId === 'main' && provider === 'gdelt' && configuration.gdeltEnabled,
            reserved: c?.reserved ?? 0, succeeded: c?.succeeded ?? 0, failed: c?.failed ?? 0, pending: c?.pending ?? 0, lastCompletedAtMs: last.at };
        }) } };
    },
    'news.analysis.set-enabled': (p: { readonly enabled: boolean }) => {
      const mapping = readNewsAnalysisConfiguration(database);
      if (profileId !== 'main' || p.enabled && (!mapping || mapping.reviewedAtMs > clock.nowMs() || readNewsRegistryEvidence(mapping, clock.nowMs(), database).length !== mapping.instruments.length)) {
        return { ok: false, issues: [{ code: 'news_mapping_required' }] };
      }
      saveNewsAnalysisEnabled(p.enabled, database); return { ok: true, value: { enabled: p.enabled } };
    },
  } as ChannelHandlers;
}
