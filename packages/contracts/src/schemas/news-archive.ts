import * as z from 'zod';
import { epochMillisecondsSchema as ms } from '../messages.js';
import { newsObservationSchema } from './news.js';
import { newsAnalysisRunSchema, newsClusterSnapshotSchema, newsFeatureSnapshotSchema, newsObservationAnalysisSchema, newsAnalysisChunkSchema } from './news-intelligence.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const newsArchiveObservationSchema = z.strictObject({ observationId: hash, articleId: hash, providerRecordId: hash, canonicalUrl: z.url(), urlHash: hash,
  normalizationVersion: z.literal(1), contentHash: hash, observation: newsObservationSchema, persistedAtMs: ms, availableAtMs: ms });
export const newsArchivePayloadSchemas = { observation: newsArchiveObservationSchema, run: newsAnalysisRunSchema, analysis: newsObservationAnalysisSchema,
  cluster: newsClusterSnapshotSchema, feature: newsFeatureSnapshotSchema, chunk: newsAnalysisChunkSchema } as const;
export const newsArchiveRecordSchema = z.strictObject({ kind: z.enum(['observation', 'run', 'analysis', 'cluster', 'feature', 'chunk']), key: z.string().min(1).max(200), payload: z.unknown(), contentHash: hash });
export const newsArchiveManifestSchema = z.strictObject({ schemaVersion: z.literal(1), datasetHash: hash, manifestHash: hash,
  inputCutoffMs: ms, createdAtMs: ms, codeRevision: z.string().min(1).max(200), recordCount: z.number().int().min(1).max(100_000),
  dependencies: z.strictObject({ duckdb: z.string(), node: z.string() }),
  attribution: z.literal('GDELT Project — https://www.gdeltproject.org/'),
  files: z.array(z.strictObject({ path: z.string(), sha256: hash, byteLength: z.number().int().nonnegative(), rowCount: z.number().int().nonnegative() })).min(1).max(400) });
export type NewsArchiveManifest = z.infer<typeof newsArchiveManifestSchema>;
