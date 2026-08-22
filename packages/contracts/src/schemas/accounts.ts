import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

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
  'accounts.settings': {
    request: z.strictObject({ profileId: z.string().min(1).max(64) }).readonly(),
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
