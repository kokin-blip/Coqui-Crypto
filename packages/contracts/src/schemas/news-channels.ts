import * as z from 'zod';
import { epochMillisecondsSchema as ms } from '../messages.js';
import { newsObservationSchema, newsProviderIdSchema } from './news.js';
import { newsObservationAnalysisSchema, newsFeatureSnapshotSchema } from './news-intelligence.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/u), count = z.number().int().nonnegative().safe();
export const newsChannelSchemas = {
  'news.timeline': { request: z.strictObject({ asOfMs: ms.nullable(), limit: z.number().int().min(1).max(100) }),
    response: z.strictObject({ asOfMs: ms, observations: z.array(z.strictObject({ id: hash, articleId: hash,
      observation: newsObservationSchema, availableAtMs: ms })).max(100) }) },
  'news.detail': { request: z.strictObject({ observationId: hash, asOfMs: ms.nullable() }),
    response: z.strictObject({ analyses: z.array(newsObservationAnalysisSchema).max(100), features: z.array(newsFeatureSnapshotSchema).max(6) }) },
  'news.health': { request: z.strictObject({}), response: z.strictObject({ asOfMs: ms, mainProfile: z.boolean(),
    collectionEnabled: z.boolean(), analysisEnabled: z.boolean(), mappingReady: z.boolean(),
    providers: z.array(z.strictObject({ provider: newsProviderIdSchema, enabled: z.boolean(), reserved: count,
      succeeded: count, failed: count, pending: count, lastCompletedAtMs: ms.nullable() })).max(3),
    latestAnalysisAtMs: ms.nullable(), coverageComplete: z.null(), studyStatus: z.enum(['not_run', 'insufficient_evidence', 'evaluated']) }) },
  'news.analysis.set-enabled': { request: z.strictObject({ commandId: z.string().uuid(), enabled: z.boolean() }),
    response: z.strictObject({ enabled: z.boolean() }) },
} as const;
