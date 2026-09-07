import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { sha256HexSchema } from './provenance.js';

const subsystem = z.enum(['host', 'market', 'risk', 'research', 'routing', 'execution']);

export const operationsChannelSchemas = {
  'operations.floor': {
    request: z.strictObject({}).readonly(),
    response: z.strictObject({
      asOfMs: epochMillisecondsSchema,
      subsystems: z.array(z.strictObject({
        subsystem,
        state: z.enum(['nominal', 'active', 'attention', 'unavailable']),
        title: z.string().min(1).max(80),
        detail: z.string().min(1).max(320),
        evidenceAtMs: epochMillisecondsSchema.nullable(),
        evidenceId: z.string().min(1).max(128).nullable(),
        decisionId: sha256HexSchema.nullable(),
        scope: z.enum(['profile', 'global']),
      }).readonly()).length(6).readonly(),
    }).readonly(),
  },
} as const;
