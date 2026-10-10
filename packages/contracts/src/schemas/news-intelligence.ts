import * as z from 'zod';
import { epochMillisecondsSchema as ms } from '../messages.js';
import { newsEntitySchema, newsProviderIdSchema } from './news.js';

const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const host = text(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/u);
const count = z.number().int().nonnegative().safe();
const score = z.number().min(-1).max(1).nullable();
const asset = z.enum(['BTC', 'ETH', 'SOL']);
const instrument = z.strictObject({ venue: z.literal('coinbase'), productId: text(128).refine(s => !s.includes('|')),
  productType: z.literal('spot') }).readonly();
const label = z.enum(['macro', 'regulatory', 'exchange', 'security', 'protocol', 'market_structure', 'other']);
export const newsIntelligenceConfigurationSchema = z.strictObject({ schemaVersion: z.literal(1), reviewedAtMs: ms,
  instruments: z.array(z.strictObject({ asset, instrument }).readonly()).min(1).max(3).readonly(),
  publisherAliases: z.array(z.strictObject({ from: host, to: host }).readonly()).max(100).readonly(),
}).refine(c => new Set(c.instruments.map(i => i.asset)).size === c.instruments.length &&
  new Set(c.instruments.map(i => i.instrument.productId)).size === c.instruments.length &&
  new Set(c.publisherAliases.map(a => a.from)).size === c.publisherAliases.length &&
  !c.publisherAliases.some(a => c.publisherAliases.some(b => b.from === a.to)), 'Duplicate or chained aliases.').readonly();
const registry = z.strictObject({ asset, instrument, name: text(256), baseAsset: text(128), quoteAsset: text(128),
  createdAtMs: ms, updatedAtMs: ms }).refine(r => r.createdAtMs <= r.updatedAtMs).readonly();
const resolution = z.strictObject({ candidate: text(256), origin: z.enum(['text', 'provider']), entityIndex: count.nullable(),
  asset: asset.nullable(), instrument: instrument.nullable(), status: z.enum(['resolved', 'unresolved']),
  reason: z.enum(['explicit_name', 'crypto_qualified', 'provider_crypto', 'ambiguous_ticker', 'equity', 'unsupported', 'missing_registry', 'quote_currency']),
}).refine(r => (r.status === 'resolved') === (r.instrument !== null && r.asset !== null) &&
  (r.origin === 'provider') === (r.entityIndex !== null)).readonly();
const instrumentAnalysis = z.strictObject({ asset, instrument, sentimentScore: score,
  sentimentReason: z.enum(['positive', 'negative', 'conflicting', 'insufficient', 'unsupported_language']),
  clauses: z.array(text(9_100)).max(500).readonly(),
  providerEntities: z.array(z.strictObject({ index: count, entity: newsEntitySchema }).readonly()).max(100).readonly(),
}).refine(i => i.sentimentScore === (i.sentimentReason === 'positive' ? 1 : i.sentimentReason === 'negative' ? -1 : null)).readonly();
export const newsObservationAnalysisSchema = z.strictObject({ schemaVersion: z.literal(1), observationId: hash,
  providerRecordId: hash, observedAtMs: ms, articleId: hash, provider: newsProviderIdSchema, availableAtMs: ms, firstAvailableAtMs: ms, publisher: host,
  title: text(1_000), description: text(8_000).nullable(), eventLabel: label,
  resolutions: z.array(resolution).max(106).readonly(), instruments: z.array(instrumentAnalysis).max(3).readonly(),
}).refine(a => a.firstAvailableAtMs <= a.availableAtMs && a.observedAtMs <= a.availableAtMs).readonly();
export const newsClusterSnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), id: hash, algorithmVersion: z.literal('news-syndication-v1'), inputCutoffMs: ms,
  articleIds: z.array(hash).min(1).max(20_000).readonly(), observationIds: z.array(hash).min(1).max(20_000).readonly(),
  publishers: z.array(host).min(1).max(20_000).readonly(),
  matches: z.array(z.strictObject({ leftArticleId: hash, rightArticleId: hash,
    kind: z.enum(['exact_title', 'similar_title']), similarity: z.number().min(0).max(1) }).readonly()).max(50_000).readonly(),
}).readonly();
const eventCounts = z.strictObject({ macro: count, regulatory: count, exchange: count, security: count, protocol: count,
  market_structure: count, other: count }).readonly();
const window = z.strictObject({ windowMs: z.union([z.literal(3_600_000), z.literal(86_400_000)]), articleCount: count,
  groupCount: count, publisherCount: count, sentimentMean: score, sentimentSampleCount: count,
  providerSentimentMean: score, providerSentimentSampleCount: count, eventCounts, dataAgeSeconds: z.number().nonnegative().nullable(),
}).readonly();
export const newsFeatureSnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), id: hash, runId: hash,
  featureVersion: z.enum(['news-features-v1', 'news-features-window-v2']), instrument, cadence: z.enum(['hourly', 'daily']), decisionAtMs: ms,
  availableAtMs: ms, reconstruction: z.boolean(), windows: z.array(window).length(2).readonly(),
  volumeZScore24h: z.number().nullable(), baselineSnapshotIds: z.array(hash).max(30).readonly(), clusterSnapshotIds: z.array(hash).max(20_000).readonly(), coverageComplete: z.null(),
  coverage: z.array(z.strictObject({ provider: newsProviderIdSchema, reserved: count, succeeded: count, failed: count, pending: count })
    .refine(c => c.succeeded + c.failed + c.pending === c.reserved).readonly()).max(3).readonly(),
  missingReasons: z.array(text(128)).max(10).readonly(),
}).refine(s => s.decisionAtMs % (s.cadence === 'hourly' ? 3_600_000 : 86_400_000) === 0 &&
  s.availableAtMs >= s.decisionAtMs && s.windows[0]?.windowMs === 3_600_000 && s.windows[1]?.windowMs === 86_400_000).readonly();
export const newsAnalysisRunSchema = z.strictObject({ schemaVersion: z.literal(1), id: hash,
  algorithmVersion: z.enum(['news-intelligence-v1', 'news-intelligence-window-v2']), inputWindowStartMs: ms.optional(),
  chunkIds: z.array(hash).max(20_000).readonly().optional(), inputCutoffMs: ms, completedAtMs: ms, persistedAtMs: ms, availableAtMs: ms,
  configuration: newsIntelligenceConfigurationSchema, registry: z.array(registry).max(3).readonly(),
  inputObservationIds: z.array(hash).max(20_000).readonly(),
}).refine(r => (r.algorithmVersion === 'news-intelligence-window-v2' ? r.inputWindowStartMs !== undefined && r.chunkIds !== undefined && r.inputWindowStartMs <= r.inputCutoffMs : r.inputWindowStartMs === undefined && r.chunkIds === undefined && r.inputObservationIds.length <= 10_000) && r.configuration.reviewedAtMs <= r.inputCutoffMs && r.inputCutoffMs <= r.completedAtMs &&
  r.completedAtMs <= r.persistedAtMs && r.availableAtMs === r.persistedAtMs &&
  r.registry.every(i => i.updatedAtMs <= r.inputCutoffMs)).readonly();


export const newsAnalysisChunkSchema = z.strictObject({ version: z.literal('news-analysis-chunk-v1'),
  configurationHash: hash, observationIds: z.array(hash).min(1).max(250).readonly(), completedAtMs: ms, persistedAtMs: ms,
}).refine(c => c.completedAtMs <= c.persistedAtMs && new Set(c.observationIds).size === c.observationIds.length).readonly();
