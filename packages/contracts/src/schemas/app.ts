import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

const productIdSchema = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/u);
const intervalSchema = z.enum(['1m', '5m', '15m', '1h', '6h', '1d']);
const layoutSchema = z.enum(['single', 'horizontal', 'vertical', 'grid', 'dominant']);
const chartStyleSchema = z.enum(['candles', 'line', 'area', 'baseline']);
const scaleModeSchema = z.enum(['linear', 'percentage', 'indexed', 'logarithmic']);
const indicatorSetSchema = z.strictObject({
  sma20: z.boolean(), sma50: z.boolean(), ema20: z.boolean(),
  bollinger20: z.boolean(), rsi14: z.boolean(), macd: z.boolean(),
}).readonly();
const chartTileSchema = z.strictObject({
  productId: productIdSchema,
  interval: intervalSchema,
  linkGroup: z.string().max(32).nullable(),
  chartStyle: chartStyleSchema.optional(),
  scaleMode: scaleModeSchema.optional(),
  indicatorSet: indicatorSetSchema.optional(),
  compareProductIds: z.array(productIdSchema).max(3).readonly().optional(),
}).readonly();
const drawingKindSchema = z.enum(['horizontal', 'vertical', 'trend', 'ray', 'rectangle', 'fibonacci', 'text', 'measure']);
const drawingSchema = z.strictObject({
  id: z.string().uuid(),
  productId: productIdSchema,
  interval: intervalSchema,
  layoutId: z.string().uuid().nullable(),
  kind: drawingKindSchema,
  points: z.array(z.strictObject({
    timeMs: z.number().int().nonnegative(),
    value: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u),
  }).readonly()).min(1).max(2).readonly(),
  label: z.string().max(80).nullable(),
}).readonly();

const personIdentitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  displayName: z.string().min(1).max(40).nullable(),
  introState: z.enum(['not_started', 'in_progress', 'skipped', 'portfolio_ready']),
  createdAtMs: epochMillisecondsSchema,
  updatedAtMs: epochMillisecondsSchema,
  skippedAtMs: epochMillisecondsSchema.nullable(),
  completedAtMs: epochMillisecondsSchema.nullable(),
}).readonly();

const readinessStepId = z.enum([
  'connection', 'sync', 'portfolio', 'allocation', 'market_data', 'paper_campaign', 'first_decision',
]);

const profileReadinessSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profileId: z.string().min(1).max(64),
  stage: z.union([readinessStepId, z.literal('ready')]),
  portfolioReady: z.boolean(),
  firstDecisionComplete: z.boolean(),
  steps: z.array(z.strictObject({
    id: readinessStepId,
    status: z.enum(['complete', 'current', 'blocked', 'pending']),
    title: z.string().min(1).max(80),
    detail: z.string().min(1).max(240),
    reasonCode: z.string().min(1).max(80).nullable(),
    route: z.enum(['#/settings', '#/portfolio/holdings', '#/portfolio/allocation', '#/markets', '#/paper/overview', '#/activity']),
    actionLabel: z.string().min(1).max(48),
  }).readonly()).length(7).readonly(),
  asOfMs: epochMillisecondsSchema,
}).readonly();

export const appChannelSchemas = {
  'app.person': {
    request: z.strictObject({}).readonly(), response: personIdentitySchema,
  },
  'app.person.set': {
    request: z.strictObject({ commandId: z.string().uuid(), displayName: z.string().min(1).max(40) }).readonly(),
    response: personIdentitySchema,
  },
  'app.onboarding.status': {
    request: z.strictObject({}).readonly(), response: personIdentitySchema,
  },
  'app.onboarding.skip': {
    request: z.strictObject({ commandId: z.string().uuid() }).readonly(), response: personIdentitySchema,
  },
  'app.onboarding.restart': {
    request: z.strictObject({ commandId: z.string().uuid() }).readonly(), response: personIdentitySchema,
  },
  'app.onboarding.complete': {
    request: z.strictObject({ commandId: z.string().uuid() }).readonly(), response: personIdentitySchema,
  },
  'app.profile-readiness': {
    request: z.strictObject({}).readonly(), response: profileReadinessSchema,
  },
  'app.chart.snapshot.save': {
    request: z.strictObject({
      commandId: z.string().uuid(),
      filenameStem: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u),
      pngBase64: z.string().min(12).max(11_200_000),
    }).readonly(),
    response: z.strictObject({ outcome: z.enum(['saved', 'cancelled']) }).readonly(),
  },
  'app.chart.workspace': {
    request: z.strictObject({ productId: productIdSchema, interval: intervalSchema }).readonly(),
    response: z.strictObject({
      watchlists: z.array(z.strictObject({
        id: z.string().uuid(), name: z.string().min(1).max(40),
        productIds: z.array(productIdSchema).max(100).readonly(), isDefault: z.boolean(),
      }).readonly()).max(20).readonly(),
      layouts: z.array(z.strictObject({
        id: z.string().uuid(), name: z.string().min(1).max(60), layout: layoutSchema,
        tiles: z.array(chartTileSchema).min(1).max(4).readonly(),
      }).readonly()).max(20).readonly(),
      drawings: z.array(drawingSchema).max(500).readonly(),
    }).readonly(),
  },
  'app.chart.workspace.set': {
    request: z.strictObject({
      commandId: z.string().uuid(),
      action: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('save_watchlist'), id: z.string().uuid(),
          name: z.string().min(1).max(40), productIds: z.array(productIdSchema).max(100).readonly(),
          isDefault: z.boolean() }).readonly(),
        z.strictObject({ kind: z.literal('save_layout'), id: z.string().uuid(),
          name: z.string().min(1).max(60), layout: layoutSchema,
          tiles: z.array(chartTileSchema).min(1).max(4).readonly() }).readonly(),
        z.strictObject({ kind: z.literal('save_drawing'), drawing: drawingSchema }).readonly(),
        z.strictObject({ kind: z.literal('delete_drawing'), drawingId: z.string().uuid() }).readonly(),
      ]),
    }).readonly(),
    response: z.strictObject({ outcome: z.enum(['saved', 'deleted']), id: z.string().uuid() }).readonly(),
  },
} as const;
