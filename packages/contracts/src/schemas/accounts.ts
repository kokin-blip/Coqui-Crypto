import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

const emptyPayloadSchema = z.strictObject({}).readonly();
const profileIdSchema = z.string().min(1).max(64);
const coinbaseConnectionSchema = z.strictObject({
  asOfMs: epochMillisecondsSchema,
  profileId: profileIdSchema,
  provider: z.literal('coinbase'),
  state: z.enum(['connected', 'disconnected', 'attention_required', 'unavailable']),
  reasonCode: z.enum([
    'credential_missing', 'credential_invalid', 'manifest_identity_missing',
    'identity_mismatch', 'portfolio_identity_missing', 'secret_store_unavailable',
  ]).nullable(),
  permissionMode: z.enum(['view_only', 'unknown']),
  portfolioIdentityVerified: z.boolean(),
  readOnly: z.literal(true),
  executionAuthority: z.literal(false),
  transferAuthority: z.literal(false),
  receiveAuthority: z.literal(false),
}).readonly();

const coinbaseSyncSchema = z.strictObject({
  profileId: profileIdSchema,
  requestedAtMs: epochMillisecondsSchema,
  receivedAtMs: epochMillisecondsSchema,
  datasetHash: z.string().regex(/^[0-9a-f]{64}$/u),
  accountCount: z.number().int().nonnegative().max(10_000),
  fillCount: z.number().int().nonnegative().max(100_000),
  transactionCount: z.number().int().nonnegative().max(100_000),
  feeTierCaptured: z.boolean(),
  discrepancyCount: z.number().int().nonnegative().max(10_000),
  evidenceCount: z.number().int().positive().max(120_001),
  created: z.boolean(),
  portfolioMutated: z.literal(false),
  syntheticLotsCreated: z.literal(false),
  syntheticFillsCreated: z.literal(false),
}).readonly();
const profileSchema = z
  .strictObject({
    id: profileIdSchema,
    name: z.string().min(1).max(40),
    color: z.string().regex(/^#[0-9a-f]{6}$/iu),
    icon: z.enum(['wallet', 'star', 'shield', 'rocket', 'leaf', 'diamond']),
    isActive: z.boolean(),
    createdAtMs: epochMillisecondsSchema,
    lastOpenedAtMs: epochMillisecondsSchema,
    order: z.number().int().nonnegative(),
  })
  .readonly();

/**
 * Presentation preferences only.
 *
 * Accounts owns theme, density, motion and language and nothing else — every
 * financial, tax, provider and strategy setting the predecessor kept here is
 * deliberately excluded, and the service rejects them rather than dropping them
 * silently.
 */
const workspacePreferenceFields = {
  workspaceMode: z.enum(['advanced', 'simple']),
  overviewChart: z.enum(['equity', 'allocation']),
  portfolioChart: z.enum(['holdings', 'allocation']),
  marketsChart: z.enum(['candles', 'line']),
  performanceChart: z.enum(['equity', 'drawdown', 'calendar', 'distribution']),
  inspectorOpen: z.boolean(),
  inspectorWidthPx: z.number().int().min(280).max(420),
  chartRanges: z.strictObject({
    overview: z.enum(['1d', '1w', '1m', '3m', '1y', 'all']),
    portfolio: z.enum(['1d', '1w', '1m', '3m', '1y', 'all']),
    markets: z.enum(['1d', '1w', '1m', '3m', '1y', 'all']),
    performance: z.enum(['1d', '1w', '1m', '3m', '1y', 'all']),
  }).readonly(),
  advancedOverviewPreset: z.enum(['research_grid', 'chart_focus', 'evidence_review', 'custom']),
  advancedOverviewPanels: z.strictObject({
    strategyDetail: z.boolean(),
    strategyComparison: z.boolean(),
    recentActivity: z.boolean(),
    proposalPreview: z.boolean(),
    healthStrip: z.boolean(),
    negativeFindings: z.boolean(),
  }).readonly(),
  overviewSeriesStyle: z.enum(['line', 'area', 'baseline']),
  overviewBenchmarkVisible: z.boolean(),
  marketVolumeVisible: z.boolean(),
  marketIndicators: z.strictObject({
    sma20: z.boolean(),
    sma50: z.boolean(),
    ema20: z.boolean(),
    bollinger20: z.boolean(),
    rsi14: z.boolean(),
    macd: z.boolean(),
  }).readonly(),
  marketInterval: z.enum(['1m', '5m', '15m', '1h', '6h', '1d']),
  marketScaleMode: z.enum(['linear', 'percentage', 'indexed', 'logarithmic']),
  marketLiveCandle: z.boolean(),
  marketLayout: z.enum(['single', 'horizontal', 'vertical', 'grid', 'dominant']),
} as const;
const workspacePreferencesSchema = z.strictObject(workspacePreferenceFields).readonly();

const displayPreferenceFields = {
  theme: z.enum(['system', 'light', 'dark', 'high_contrast']),
  density: z.enum(['comfortable', 'compact']),
  motion: z.enum(['system', 'reduced', 'none']),
  language: z.enum(['en', 'es']),
} as const;

const preferencesSchema = z
  .strictObject({
    ...displayPreferenceFields,
    ...workspacePreferenceFields,
  })
  .readonly();

const preferenceViewFields = {
  profileId: z.string().min(1).max(64),
  asOfMs: epochMillisecondsSchema,
  updatedAtMs: epochMillisecondsSchema.nullable(),
  source: z.enum(['default', 'saved']),
} as const;

const displayPatchSchema = z.strictObject({
  theme: displayPreferenceFields.theme.optional(),
  density: displayPreferenceFields.density.optional(),
  motion: displayPreferenceFields.motion.optional(),
  language: displayPreferenceFields.language.optional(),
});

const workspacePatchSchema = z.strictObject(workspacePreferenceFields).partial();

export const accountsChannelSchemas = {
  'accounts.coinbase.status': {
    request: emptyPayloadSchema,
    response: coinbaseConnectionSchema,
  },
  'accounts.coinbase.connect': {
    request: z.strictObject({
      commandId: z.string().uuid(),
      keyName: z.string().min(1).max(512),
      privateKey: z.string().min(1).max(65_536),
    }).readonly(),
    response: coinbaseConnectionSchema,
  },
  'accounts.coinbase.connect-json': {
    request: z.strictObject({
      commandId: z.string().uuid(),
      contents: z.string().min(1).max(65_536),
    }).readonly(),
    response: coinbaseConnectionSchema,
  },
  'accounts.coinbase.disconnect': {
    request: z.strictObject({ commandId: z.string().uuid() }).readonly(),
    response: coinbaseConnectionSchema,
  },
  'accounts.coinbase.sync': {
    request: z.strictObject({ commandId: z.string().uuid() }).readonly(),
    response: coinbaseSyncSchema,
  },
  'accounts.profiles': {
    request: emptyPayloadSchema,
    response: z
      .strictObject({
        profiles: z.array(profileSchema).max(32).readonly(),
        activeProfile: profileSchema,
      })
      .readonly(),
  },
  'accounts.profile.switch': {
    request: z
      .strictObject({
        commandId: z.string().uuid(),
        profileId: profileIdSchema,
      })
      .readonly(),
    response: z
      .strictObject({
        activeProfile: profileSchema,
        switchedAtMs: epochMillisecondsSchema,
      })
      .readonly(),
  },
  'accounts.settings': {
    request: emptyPayloadSchema,
    response: z
      .strictObject({
        ...preferenceViewFields,
        /** Lets a surface distinguish an unset default from an explicit choice. */
        preferences: preferencesSchema,
      })
      .readonly(),
  },
  'accounts.settings.set': {
    request: z.strictObject({
      commandId: z.string().uuid(),
      patch: displayPatchSchema,
    }).readonly(),
    response: z.strictObject({
      ...preferenceViewFields,
      preferences: preferencesSchema,
    }).readonly(),
  },
  'accounts.workspace': {
    request: emptyPayloadSchema,
    response: z.strictObject({
      ...preferenceViewFields,
      preferences: workspacePreferencesSchema,
    }).readonly(),
  },
  'accounts.workspace.set': {
    request: z.strictObject({
      commandId: z.string().uuid(),
      patch: workspacePatchSchema,
    }).readonly(),
    response: z.strictObject({
      ...preferenceViewFields,
      preferences: workspacePreferencesSchema,
    }).readonly(),
  },
} as const;
