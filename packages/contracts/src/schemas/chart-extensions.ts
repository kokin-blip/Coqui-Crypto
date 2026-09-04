import * as z from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9.-]{2,63}$/u);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const settingValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
const settings = z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/u), settingValue).refine(
  (value) => Object.keys(value).length <= 32,
);
const settingDefinition = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/u),
  label: z.string().min(1).max(80),
  type: z.enum(['boolean', 'number', 'string']),
  required: z.boolean(),
  default: settingValue.optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
}).readonly();
const declaredOutput = z.discriminatedUnion('kind', [
  z.strictObject({ id, kind: z.literal('series'), title: z.string().min(1).max(80),
    pane: z.number().int().min(0).max(3), color: z.string().regex(/^#[0-9a-f]{6}$/iu) }).readonly(),
  z.strictObject({ id, kind: z.literal('markers'), title: z.string().min(1).max(80),
    condition: z.enum(['positive', 'negative', 'nonzero']),
    tone: z.enum(['neutral', 'positive', 'negative', 'warning']) }).readonly(),
]);
const extension = z.strictObject({
  id, name: z.string().min(1).max(80), version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  author: z.string().min(1).max(80), license: z.string().min(1).max(80),
  signerKeyId: hash, payloadHash: hash, enabled: z.boolean(), settings,
  compatibility: z.strictObject({ min: z.string(), maxExclusive: z.string() }).readonly(),
  permissions: z.tuple([z.literal('immutable_display_bars')]).readonly(),
  settingsSchema: z.array(settingDefinition).max(32).readonly(),
  outputs: z.array(declaredOutput).min(1).max(8).readonly(),
  installedAtMs: z.number().int().nonnegative(),
}).readonly();
const bar = z.strictObject({
  timeMs: z.number().int().nonnegative(),
  open: z.string(), high: z.string(), low: z.string(), close: z.string(), volume: z.string().nullable(),
}).readonly();

export const chartExtensionChannelSchemas = {
  'chart-extensions.catalog': {
    request: z.strictObject({}).readonly(),
    response: z.strictObject({
      signers: z.array(z.strictObject({ keyId: hash, displayName: z.string(), trustedAtMs: z.number().int(), revokedAtMs: z.number().int().nullable() }).readonly()).max(32).readonly(),
      extensions: z.array(extension).max(100).readonly(),
    }).readonly(),
  },
  'chart-extensions.signer.trust': {
    request: z.strictObject({ commandId: z.string().uuid(), displayName: z.string().min(1).max(80),
      publicKeyBase64: z.string().min(40).max(256), confirmed: z.literal(true) }).readonly(),
    response: z.strictObject({ outcome: z.literal('trusted'), keyId: hash }).readonly(),
  },
  'chart-extensions.signer.remove': {
    request: z.strictObject({ commandId: z.string().uuid(), keyId: hash, confirmed: z.literal(true) }).readonly(),
    response: z.strictObject({ outcome: z.literal('revoked'), keyId: hash, disabledCount: z.number().int().nonnegative() }).readonly(),
  },
  'chart-extensions.install': {
    request: z.strictObject({ commandId: z.string().uuid(), packageJson: z.string().min(2).max(2_800_000), confirmed: z.literal(true) }).readonly(),
    response: z.strictObject({ outcome: z.enum(['installed', 'updated']), extensionId: id }).readonly(),
  },
  'chart-extensions.install.pick': {
    request: z.strictObject({ commandId: z.string().uuid(), confirmed: z.literal(true) }).readonly(),
    response: z.discriminatedUnion('outcome', [
      z.strictObject({ outcome: z.enum(['installed', 'updated']), extensionId: id }).readonly(),
      z.strictObject({ outcome: z.literal('cancelled') }).readonly(),
    ]),
  },
  'chart-extensions.set': {
    request: z.strictObject({ commandId: z.string().uuid(), extensionId: id,
      enabled: z.boolean(), settings }).readonly(),
    response: z.strictObject({ outcome: z.enum(['enabled', 'disabled']), extensionId: id }).readonly(),
  },
  'chart-extensions.remove': {
    request: z.strictObject({ commandId: z.string().uuid(), extensionId: id, confirmed: z.literal(true) }).readonly(),
    response: z.strictObject({ outcome: z.literal('uninstalled'), extensionId: id }).readonly(),
  },
  'chart-extensions.evaluate': {
    request: z.strictObject({ extensionId: id, bars: z.array(bar).min(1).max(2_000).readonly() }).readonly(),
    response: z.strictObject({
      series: z.array(z.strictObject({ id, title: z.string().max(80), pane: z.number().int().min(0).max(3),
        color: z.string().regex(/^#[0-9a-f]{6}$/iu), points: z.array(z.strictObject({ timeMs: z.number().int().nonnegative(), value: z.string() }).readonly()).max(2_000).readonly() }).readonly()).max(8).readonly(),
      markers: z.array(z.strictObject({ timeMs: z.number().int().nonnegative(), label: z.string().max(40), tone: z.enum(['neutral', 'positive', 'negative', 'warning']) }).readonly()).max(200).readonly(),
      informationalOnly: z.literal(true), decisionEligible: z.literal(false),
    }).readonly(),
  },
} as const;
