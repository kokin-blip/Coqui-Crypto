import * as z from 'zod';

export const appChannelSchemas = {
  'app.chart.snapshot.save': {
    request: z.strictObject({
      commandId: z.string().uuid(),
      filenameStem: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u),
      pngBase64: z.string().min(12).max(11_200_000),
    }).readonly(),
    response: z.strictObject({ outcome: z.enum(['saved', 'cancelled']) }).readonly(),
  },
} as const;
