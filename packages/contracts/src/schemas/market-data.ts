import * as z from 'zod';

import {
  barProvenanceSchema,
  decimalStringSchema,
  instrumentIdentitySchema,
  referenceViewSchema,
} from './provenance.js';
import { epochMillisecondsSchema } from '../messages.js';

const percentSchema = z.number().finite().nullable();
const emptyPayloadSchema = z.strictObject({}).readonly();

const referencePriceSchema = z
  .strictObject({
    instrument: instrumentIdentitySchema,
    priceUsd: decimalStringSchema,
    change24hPct: percentSchema,
    providerUpdatedAtMs: epochMillisecondsSchema.nullable(),
  })
  .readonly();

const referenceMarketRowSchema = z
  .strictObject({
    instrument: instrumentIdentitySchema,
    priceUsd: decimalStringSchema,
    change24hPct: percentSchema,
    providerUpdatedAtMs: epochMillisecondsSchema.nullable(),
    marketCapUsd: decimalStringSchema.nullable(),
    volume24hUsd: decimalStringSchema.nullable(),
    marketCapRank: z.number().int().positive().nullable(),
  })
  .readonly();

const fearGreedSchema = z
  .strictObject({
    value: z.number().int().min(0).max(100),
    classification: z.string().min(1).max(64),
  })
  .readonly();

const trendingCoinSchema = z
  .strictObject({
    coingeckoId: z.string().min(1).max(128),
    symbol: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,31}$/),
    name: z.string().min(1).max(128),
    marketCapRank: z.number().int().positive().nullable(),
    /** HTTPS only; the CSP would reject anything else and a surface must not try. */
    thumbnailUrl: z.url({ protocol: /^https$/ }).max(512).nullable(),
  })
  .readonly();

const assetYieldSchema = z
  .strictObject({
    symbol: z.string().regex(/^[A-Z0-9]{1,32}$/),
    apyPct: z.number().finite().positive(),
    project: z.string().min(1).max(128),
    chain: z.string().min(1).max(128),
    tvlUsd: z.number().finite().nonnegative(),
  })
  .readonly();

const newsItemSchema = z
  .strictObject({
    title: z.string().min(1).max(400),
    url: z.url({ protocol: /^https$/ }).max(1024),
    source: z.string().min(1).max(64),
    publishedAtMs: epochMillisecondsSchema.nullable(),
  })
  .readonly();

const policyItemSchema = z
  .strictObject({
    title: z.string().min(1).max(400),
    url: z.url({ protocol: /^https$/ }).max(1024),
    source: z.string().min(1).max(64),
    publishedAtMs: epochMillisecondsSchema.nullable(),
    matched: z.array(z.string().min(1).max(64)).max(32).readonly(),
  })
  .readonly();

const marketBarSchema = z
  .strictObject({
    assetId: z.string().min(1).max(160),
    source: z.string().min(1).max(32),
    interval: z.literal('1d'),
    startTimeMs: epochMillisecondsSchema,
    endTimeMs: epochMillisecondsSchema,
    open: z.number().finite(),
    high: z.number().finite(),
    low: z.number().finite(),
    close: z.number().finite(),
    volume: z.number().finite().nullable(),
    /** Literal `true`: an in-progress bar has no representation on this channel. */
    isComplete: z.literal(true),
    retrievedAtMs: epochMillisecondsSchema,
  })
  .readonly();

export const marketDataChannelSchemas = {
  'market-data.prices': {
    request: emptyPayloadSchema,
    response: referenceViewSchema(z.array(referencePriceSchema).max(500).readonly()),
  },
  'market-data.markets': {
    request: emptyPayloadSchema,
    response: referenceViewSchema(z.array(referenceMarketRowSchema).max(500).readonly()),
  },
  'market-data.fear-greed': {
    request: emptyPayloadSchema,
    response: referenceViewSchema(fearGreedSchema),
  },
  'market-data.trending': {
    request: emptyPayloadSchema,
    response: referenceViewSchema(z.array(trendingCoinSchema).max(100).readonly()),
  },
  'market-data.yields': {
    request: emptyPayloadSchema,
    response: referenceViewSchema(z.array(assetYieldSchema).max(2000).readonly()),
  },
  'market-data.news': {
    request: z.strictObject({ limit: z.number().int().min(1).max(100) }).readonly(),
    response: referenceViewSchema(
      z
        .strictObject({
          headlines: z.array(newsItemSchema).max(100).readonly(),
          policy: z.array(policyItemSchema).max(100).readonly(),
        })
        .readonly(),
    ),
  },
  'market-data.candles': {
    request: z
      .strictObject({
        instrument: instrumentIdentitySchema,
        lookbackDays: z.number().int().min(1).max(1825),
      })
      .readonly(),
    response: z
      .strictObject({
        instrument: instrumentIdentitySchema,
        bars: z.array(marketBarSchema).max(2000).readonly(),
        provenance: barProvenanceSchema,
      })
      .readonly(),
  },
} as const;
