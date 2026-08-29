import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

const emptyPayloadSchema = z.strictObject({}).readonly();
const profileIdSchema = z.string().min(1).max(64);
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
