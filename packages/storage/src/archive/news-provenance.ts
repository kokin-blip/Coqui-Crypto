import { newsEvidenceHash } from '@coqui/core';
import { newsArchivePayloadSchemas as schemas } from '@coqui/contracts';
import { newsAnalysisRunId } from '../repositories/news-intelligence.js';

/** Archives must carry the evidence graph, not just individually valid payloads. */
export function validateNewsArchiveProvenance(rows: readonly { kind: keyof typeof schemas; key: string; payload: unknown }[], cutoff: number): void {
  const records = new Map(rows.map(r => [`${r.kind}:${r.key}`, r.payload]));
  const requireRecord = (kind: keyof typeof schemas, key: string) => {
    const value = records.get(`${kind}:${key}`);
    if (!value) throw new Error('News archive provenance reference is missing.');
    return value;
  };
  const observation = (id: string, at: number) => {
    const o = schemas.observation.parse(requireRecord('observation', id));
    if (o.observationId !== id || o.availableAtMs > at) throw new Error('News archive observation was not available.');
    return o;
  };
  for (const row of rows) {
    if (row.kind === 'observation') observation(row.key, cutoff);
    if (row.kind === 'chunk') {
      const c = schemas.chunk.parse(row.payload);
      if (row.key !== newsEvidenceHash({ version: c.version, configurationHash: c.configurationHash, observationIds: c.observationIds }) || c.persistedAtMs > cutoff) throw new Error('News archive chunk identity differs.');
      for (const id of c.observationIds) {
        observation(id, c.completedAtMs);
        schemas.analysis.parse(requireRecord('analysis', `${row.key}:${id}`));
      }
    }
    if (row.kind === 'analysis') {
      const a = schemas.analysis.parse(row.payload), o = observation(a.observationId, cutoff);
      const parent = row.key.slice(0, 64);
      if (row.key !== `${parent}:${a.observationId}` || !records.has(`run:${parent}`) && !records.has(`chunk:${parent}`) ||
        a.articleId !== o.articleId || a.providerRecordId !== o.providerRecordId || a.provider !== o.observation.provider || a.availableAtMs !== o.availableAtMs) throw new Error('News archive analysis provenance differs.');
    }
    if (row.kind === 'run') {
      const r = schemas.run.parse(row.payload);
      const identity = { inputCutoffMs: r.inputCutoffMs, configuration: r.configuration, registry: r.registry, inputObservationIds: r.inputObservationIds,
        ...(r.inputWindowStartMs === undefined ? {} : { inputWindowStartMs: r.inputWindowStartMs, chunkIds: r.chunkIds! }) };
      if (row.key !== r.id || newsAnalysisRunId(identity) !== r.id || r.availableAtMs > cutoff) throw new Error('News archive run identity differs.');
      for (const id of r.inputObservationIds) { observation(id, r.inputCutoffMs); requireRecord('analysis', `${r.id}:${id}`); }
      for (const id of r.chunkIds ?? []) {
        const c = schemas.chunk.parse(requireRecord('chunk', id));
        if (c.persistedAtMs > r.inputCutoffMs || c.configurationHash !== newsEvidenceHash({ configuration: r.configuration, registry: r.registry, algorithmVersion: 'news-intelligence-v1' })) throw new Error('News archive chunk was not available to the run.');
      }
    }
    if (row.kind === 'cluster') {
      const c = schemas.cluster.parse(row.payload), r = schemas.run.parse(requireRecord('run', row.key.slice(0, 64)));
      if (row.key !== `${r.id}:${c.id}` || c.inputCutoffMs > r.inputCutoffMs || c.observationIds.some(id => !r.inputObservationIds.includes(id))) throw new Error('News archive cluster provenance differs.');
    }
    if (row.kind === 'feature') {
      const f = schemas.feature.parse(row.payload), r = schemas.run.parse(requireRecord('run', f.runId));
      if (row.key !== f.id || f.availableAtMs < r.availableAtMs || f.availableAtMs > cutoff) throw new Error('News archive feature was not available.');
      for (const id of f.clusterSnapshotIds) requireRecord('cluster', `${r.id}:${id}`);
      for (const id of f.baselineSnapshotIds) {
        const baseline = schemas.feature.parse(requireRecord('feature', id));
        if (baseline.availableAtMs > f.decisionAtMs || baseline.reconstruction) throw new Error('News archive baseline was not prospectively available.');
      }
    }
  }
}
