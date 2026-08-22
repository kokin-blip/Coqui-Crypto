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

const statusRailSchema = z
  .strictObject({
    profileId: z.string().min(1).max(64),
    // Literal 'paper': this build has no other executable mode, and the wire
    // type refuses to describe one (invariant 1).
    mode: z.literal('paper'),
    executionPermitted: z.boolean(),
    killSwitchEngaged: z.boolean(),
    killSwitchReason: z.enum(['risk_hard_stop', 'safety_stop']).nullable(),
    riskStage: z.string().min(1).max(64).nullable(),
    activeJobCount: z.number().int().nonnegative(),
    scheduledJobCount: z.number().int().nonnegative(),
    reconciliation: z
      .strictObject({
        lastRunAtMs: epochMillisecondsSchema.nullable(),
        // A count, never a severity. A discrepancy is evidence requiring user
        // resolution (invariant 12), not a blocking condition.
        unresolvedCount: z.number().int().nonnegative(),
        neverRun: z.boolean(),
      })
      .readonly(),
    costModelBps: z.number().finite().nonnegative(),
    assessedAtMs: epochMillisecondsSchema,
  })
  .readonly();

export const riskChannelSchemas = {
  'app.status-rail': {
    request: z.strictObject({ profileId: z.string().min(1).max(64) }).readonly(),
    response: statusRailSchema,
  },
  /**
   * The risk ladder, read-only by construction.
   *
   * There is no write counterpart and there will not be one: P8's exit
   * criterion is that the gate cannot be edited or overridden from the UI, and
   * the absence of a channel is the strongest form of that guarantee.
   */
  'risk.dashboard': {
    request: emptyPayloadSchema,
    response: z
      .strictObject({
        asOfMs: epochMillisecondsSchema,
        stage: z.enum(['normal', 'caution', 'defense', 'hard_stop']),
        ladder: z
          .array(
            z
              .strictObject({
                stage: z.enum(['normal', 'caution', 'defense', 'hard_stop']),
                active: z.boolean(),
                exposureScale: z.number().min(0).max(1),
                entryCondition: z.string().min(1).max(400),
              })
              .readonly(),
          )
          .max(8)
          .readonly(),
        exposureScale: z.number().min(0).max(1),
        drawdownPct: z.number(),
        expectedShortfallPct: z.number(),
        realizedVolatilityPct: z.number().nullable(),
        forecastVolatilityPct: z.number().nullable(),
        volatilityRatio: z.number().nullable(),
        maxGrossExposurePct: z.number().nonnegative(),
        maxTurnoverPct: z.number().nonnegative(),
        maxTradeCount: z.number().int().nonnegative(),
        staleMarketData: z.boolean(),
        blockReason: z.string().min(1).max(200).nullable(),
        warnings: z.array(z.string().min(1).max(200)).max(20).readonly(),
        sampleCount: z.number().int().nonnegative(),
        snapshotAgeMs: z.number().int().nonnegative().nullable(),
        insufficientHistory: z.boolean(),
      })
      .readonly(),
  },
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
