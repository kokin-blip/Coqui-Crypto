import * as z from 'zod';

const productIdSchema = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/u);
const intervalSchema = z.enum(['1m', '5m', '15m', '1h', '6h', '1d']);
const layoutSchema = z.enum(['single', 'horizontal', 'vertical', 'grid', 'dominant']);
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

export const appChannelSchemas = {
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
        tiles: z.array(z.strictObject({
          productId: productIdSchema, interval: intervalSchema,
          linkGroup: z.string().max(32).nullable(),
        }).readonly()).min(1).max(4).readonly(),
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
          tiles: z.array(z.strictObject({ productId: productIdSchema, interval: intervalSchema,
            linkGroup: z.string().max(32).nullable() }).readonly()).min(1).max(4).readonly() }).readonly(),
        z.strictObject({ kind: z.literal('save_drawing'), drawing: drawingSchema }).readonly(),
        z.strictObject({ kind: z.literal('delete_drawing'), drawingId: z.string().uuid() }).readonly(),
      ]),
    }).readonly(),
    response: z.strictObject({ outcome: z.enum(['saved', 'deleted']), id: z.string().uuid() }).readonly(),
  },
} as const;
