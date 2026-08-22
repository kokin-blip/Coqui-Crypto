import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { sha256HexSchema } from './provenance.js';

const emptyPayloadSchema = z.strictObject({}).readonly();

const jobIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, 'Expected a job id.');

/**
 * The identities that make a study result citable. The scoreboard renders these
 * beside every research figure; a figure without them is an unsourced claim.
 */
const researchRunSchema = z
  .strictObject({
    id: z.string().min(1).max(200),
    preRegistrationHash: sha256HexSchema,
    datasetHash: sha256HexSchema,
    costProfileHash: sha256HexSchema,
    codeRevision: z.string().min(1).max(200),
    selectedCandidateId: sha256HexSchema,
    adopted: z.boolean(),
    completedAtMs: epochMillisecondsSchema,
    runHash: sha256HexSchema,
  })
  .readonly();

/**
 * A closed vocabulary, not a message. The stored `error` column can hold a
 * stack or a path, so the wire admits only these tokens (invariant 3).
 */
const failureReasonSchema = z.enum([
  'none',
  'cancelled',
  'deadline_exceeded',
  'worker_failed',
  'interrupted',
  'integrity_mismatch',
]);

const jobSummarySchema = z
  .strictObject({
    id: jobIdSchema,
    kind: z.enum(['matrix', 'stress']),
    status: z.enum(['queued', 'running', 'completed', 'cancelled', 'failed']),
    createdAtMs: epochMillisecondsSchema,
    startedAtMs: epochMillisecondsSchema.nullable(),
    completedAtMs: epochMillisecondsSchema.nullable(),
    attemptCount: z.number().int().nonnegative(),
    failureReason: failureReasonSchema,
  })
  .readonly();

const jobDetailSchema = z
  .strictObject({
    id: jobIdSchema,
    kind: z.enum(['matrix', 'stress']),
    status: z.enum(['queued', 'running', 'completed', 'cancelled', 'failed']),
    createdAtMs: epochMillisecondsSchema,
    startedAtMs: epochMillisecondsSchema.nullable(),
    completedAtMs: epochMillisecondsSchema.nullable(),
    attemptCount: z.number().int().nonnegative(),
    failureReason: failureReasonSchema,
    formatVersion: z.number().int().positive(),
    snapshotHash: sha256HexSchema.nullable(),
    resultHash: sha256HexSchema.nullable(),
    deadlineAtMs: epochMillisecondsSchema.nullable(),
    /**
     * Presence, never the payload. These views feed list surfaces that have no
     * use for a multi-megabyte blob, and shipping one across IPC would block
     * the renderer for the length of its deserialization.
     */
    hasSnapshot: z.boolean(),
    hasResult: z.boolean(),
  })
  .readonly();

const scoreboardTrackSchema = z
  .strictObject({
    trackId: z.enum(['selected', 'hold', 'passive']),
    afterCostReturnPct: z.number().finite(),
    maxDrawdownPct: z.number().finite(),
    sortino: z.number().finite().nullable(),
    sharpe: z.number().finite().nullable(),
    // Nullable by design: only the selected candidate was tested for
    // significance, so a benchmark carries no DSR and no search budget.
    dsr: z.number().min(0).max(1).nullable(),
    trialCount: z.number().int().positive().nullable(),
    excessReturnVsHoldPct: z.number().finite().nullable(),
    excessReturnVsPassivePct: z.number().finite().nullable(),
  })
  .readonly();

export const researchChannelSchemas = {
  'research.scoreboard': {
    request: emptyPayloadSchema,
    response: z
      .strictObject({
        runId: z.string().min(1).max(200),
        completedAtMs: epochMillisecondsSchema,
        adopted: z.boolean(),
        tracks: z.array(scoreboardTrackSchema).max(8).readonly(),
        sampleDays: z.number().int().nonnegative().nullable(),
        datasetHash: sha256HexSchema,
        codeRevision: z.string().min(1).max(200),
        runHash: sha256HexSchema,
        // Literal false until an adopted study backs the defaults. P3's
        // replacement run was negative; the wire type will not say otherwise.
        parametersValidated: z.literal(false),
      })
      .readonly(),
  },
  'research.runs': {
    request: emptyPayloadSchema,
    response: z.array(researchRunSchema).max(500).readonly(),
  },
  'research.jobs': {
    request: z.strictObject({ limit: z.number().int().min(1).max(200) }).readonly(),
    response: z.array(jobSummarySchema).max(200).readonly(),
  },
  'research.job': {
    request: z.strictObject({ id: jobIdSchema }).readonly(),
    response: jobDetailSchema,
  },
} as const;
