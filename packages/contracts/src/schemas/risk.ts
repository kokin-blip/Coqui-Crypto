import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { sha256HexSchema } from './provenance.js';

const emptyPayloadSchema = z.strictObject({}).readonly();

/**
 * Live-gate assessment as the scoreboard renders it.
 *
 * `liveExecutionPermitted` is a literal `false`. Reaching the gate makes live
 * *considerable*, never enabled (`docs/PLAN.md` P8), and the wire type refuses
 * to carry any other value — a main process that tried to send `true` would
 * fail response validation rather than light up a control.
 */
const evidenceGateSchema = z
  .strictObject({
    code: z.enum(['significance', 'walk_forward', 'beats_benchmarks', 'sample_size']),
    met: z.boolean(),
  })
  .readonly();

const evidenceFactsSchema = z
  .strictObject({
    evidenceDayMs: epochMillisecondsSchema,
    leader: z.string().min(1).max(64),
    dsr: z.number().min(0).max(1).nullable(),
    psr: z.number().min(0).max(1).nullable(),
    significanceVerdict: z.string().min(1).max(64),
    walkForwardVerdict: z.string().min(1).max(64),
    leaderSortino: z.number().finite().nullable(),
    holdSortino: z.number().finite().nullable(),
    passiveSortino: z.number().finite().nullable(),
    sampleDays: z.number().int().nonnegative(),
  })
  .readonly();

const evidenceProvenanceSchema = z
  .strictObject({
    createdAtMs: epochMillisecondsSchema,
    datasetHash: sha256HexSchema,
    trialRegistryHash: sha256HexSchema,
    costProfileHash: sha256HexSchema,
    preRegistrationHash: sha256HexSchema,
    codeRevisionHash: sha256HexSchema,
    snapshotHash: sha256HexSchema,
  })
  .readonly();

export const riskChannelSchemas = {
  'risk.evidence-gate': {
    request: emptyPayloadSchema,
    response: z
      .strictObject({
        schemaVersion: z.literal(1),
        assessedAtMs: epochMillisecondsSchema,
        status: z.enum([
          'blocked_trial_history_incomplete',
          'blocked_no_verified_evidence',
          'blocked_invalid_evidence',
          'blocked_unsupported_evidence',
          'requirements_not_met',
          'eligible_for_review',
        ]),
        trialHistoryComplete: z.boolean(),
        source: evidenceProvenanceSchema.nullable(),
        facts: evidenceFactsSchema.nullable(),
        gates: z.array(evidenceGateSchema).max(8).readonly(),
        conversationEligible: z.boolean(),
        liveExecutionPermitted: z.literal(false),
        assessmentHash: sha256HexSchema,
      })
      .readonly(),
  },
} as const;
