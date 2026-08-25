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
const preferencesSchema = z
  .strictObject({
    theme: z.enum(['system', 'light', 'dark', 'high_contrast']),
    density: z.enum(['comfortable', 'compact']),
    motion: z.enum(['system', 'reduced', 'none']),
    language: z.enum(['en', 'es']),
  })
  .readonly();

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
        profileId: z.string().min(1).max(64),
        asOfMs: epochMillisecondsSchema,
        updatedAtMs: epochMillisecondsSchema.nullable(),
        /** Lets a surface distinguish an unset default from an explicit choice. */
        source: z.enum(['default', 'saved']),
        preferences: preferencesSchema,
      })
      .readonly(),
  },
} as const;
