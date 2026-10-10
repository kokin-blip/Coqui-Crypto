import * as z from 'zod';
import { epochMillisecondsSchema as ms } from '../messages.js';
import { newsObservationSchema, newsProviderIdSchema } from './news.js';
import { newsObservationAnalysisSchema, newsFeatureSnapshotSchema } from './news-intelligence.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/u), count = z.number().int().nonnegative().safe();
export const newsChannelSchemas = {
  'app.evidence-export': { request:z.strictObject({commandId:z.string().uuid()}),response:z.strictObject({status:z.enum(['saved','cancelled']),bundleHash:hash}) },
  'app.about': { request: z.strictObject({}), response: z.strictObject({ build: z.strictObject({ version:z.string(),sourceRevision:z.string(),sourceHash:hash,dirty:z.boolean(),channel:z.string(),builtAtMs:ms }).nullable(),schemaVersion:count,supportedSchemaVersion:count,liveExecutionEnabled:z.literal(false),publication:z.literal('unverified') }) },
  'app.performance-trace': { request: z.strictObject({}), response: z.strictObject({ enabled: z.boolean(), observedAtMs: ms,
    events: z.array(z.strictObject({ stage: z.string(), identity: z.string(), atMs: ms, durationMs: z.number().nonnegative(), count: z.number().nonnegative() })).max(2000),
    heapBytes: count, cpuUserUs: count, cpuSystemUs: count, eventLoopP95Ms: z.number().nonnegative().nullable(), eventLoopMaxMs: z.number().nonnegative().nullable() }) },
  'news.report': { request: z.strictObject({}), response: z.strictObject({
    association: z.enum(['verified','unverified','unavailable']), report: z.strictObject({ reportHash: hash,
      completedAtMs: ms, horizons: z.array(z.strictObject({ status: z.enum(['evaluated','insufficient_evidence']),
        reasons: z.array(z.string()).max(100), prospectiveRows: count, cadence: z.enum(['daily','hourly']),
        horizonHours: z.union([z.literal(1),z.literal(4),z.literal(24)]), codeRevision: z.string(), datasetHash: hash,
        costHash: hash, sourceManifestHashes: z.array(hash), manifestHash: hash })).length(4) }).nullable() }) },
  'news.timeline': { request: z.strictObject({ asOfMs: ms.nullable(), limit: z.number().int().min(1).max(100) }),
    response: z.strictObject({ asOfMs: ms, observations: z.array(z.strictObject({ id: hash, articleId: hash,
      observation: newsObservationSchema, availableAtMs: ms })).max(100) }) },
  'news.detail': { request: z.strictObject({ observationId: hash, asOfMs: ms.nullable() }),
    response: z.strictObject({ analyses: z.array(newsObservationAnalysisSchema).max(100), features: z.array(newsFeatureSnapshotSchema).max(6) }) },
  'news.health': { request: z.strictObject({}), response: z.strictObject({ asOfMs: ms, mainProfile: z.boolean(),
    collectionEnabled: z.boolean(), analysisEnabled: z.boolean(), mappingReady: z.boolean(),
    providers: z.array(z.strictObject({ provider: newsProviderIdSchema, enabled: z.boolean(), reserved: count,
      succeeded: count, failed: count, pending: count, lastCompletedAtMs: ms.nullable(),
      lastUsefulAtMs: ms.nullable(), parsed: count, retained: count, inserted: count,
      latestReason: z.string().nullable(), canonicalEligibility: z.literal('unknown') })).max(3),
    latestAnalysisAtMs: ms.nullable(), coverageComplete: z.null(), studyStatus: z.enum(['not_run', 'insufficient_evidence', 'evaluated']) }) },
  'news.analysis.set-enabled': { request: z.strictObject({ commandId: z.string().uuid(), enabled: z.boolean() }),
    response: z.strictObject({ enabled: z.boolean() }) },
} as const;
