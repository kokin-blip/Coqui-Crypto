import {
  MIN_FORWARD_PAPER_DAYS,
  MIN_FORWARD_PAPER_DECISIONS,
  MIN_FORWARD_PAPER_FILLS,
  type Clock,
  type ForwardPaperEvidence,
} from '@coqui/core';
import {
  countCompletedDecisionRuns,
  countObservedDecisionDays,
  countPaperFills,
  type Db,
} from '@coqui/storage';

/**
 * Forward paper evidence: how much the engine has actually observed.
 *
 * The thresholds and the `ForwardPaperEvidence` shape already existed in
 * `packages/core/src/realism` — 90 observed days, 50 decisions, 30 fills — and
 * nothing outside a test had ever produced one. This produces it from what the
 * run loop records.
 *
 * The counts are of *engine activity*, never of elapsed time. A week the app
 * was closed contributes nothing, which is the whole point of
 * `docs/PLAN.md` P6's "never elapsed empty days". A day the engine ran and
 * correctly stood down does count: it observed the market and decided.
 *
 * Meeting these thresholds does not enable live trading. There is no
 * order-submission path in this build, and P8 keeps the gate read-only. It
 * makes the conversation reasonable, nothing more.
 */

export interface ForwardEvidenceRequirement {
  readonly code: 'observed_days' | 'decisions' | 'fills';
  readonly observed: number;
  readonly required: number;
  readonly met: boolean;
}

export interface ForwardEvidenceView {
  readonly profileId: string;
  readonly asOfMs: number;
  readonly sinceMs: number;
  readonly evidence: ForwardPaperEvidence;
  readonly requirements: readonly ForwardEvidenceRequirement[];
  readonly allRequirementsMet: boolean;
  /**
   * Literal `false`. Reaching the thresholds makes live *considerable*, never
   * enabled, and the type refuses to say otherwise.
   */
  readonly liveExecutionPermitted: false;
}

export interface ForwardEvidenceDependencies {
  readonly database: Db;
  readonly clock: Clock;
}

function requirement(
  code: ForwardEvidenceRequirement['code'],
  observed: number,
  required: number,
): ForwardEvidenceRequirement {
  return { code, observed, required, met: observed >= required };
}

export function forwardPaperEvidence(
  dependencies: ForwardEvidenceDependencies,
  profileId: string,
  sinceMs = 0,
): ForwardEvidenceView {
  const { database } = dependencies;

  const evidence: ForwardPaperEvidence = {
    days: countObservedDecisionDays(profileId, sinceMs, database),
    decisions: countCompletedDecisionRuns(profileId, sinceMs, database),
    fills: countPaperFills(profileId, sinceMs, database),
  };

  const requirements = Object.freeze([
    requirement('observed_days', evidence.days, MIN_FORWARD_PAPER_DAYS),
    requirement('decisions', evidence.decisions, MIN_FORWARD_PAPER_DECISIONS),
    requirement('fills', evidence.fills, MIN_FORWARD_PAPER_FILLS),
  ]);

  return {
    profileId,
    asOfMs: dependencies.clock.nowMs(),
    sinceMs,
    evidence,
    requirements,
    allRequirementsMet: requirements.every((entry) => entry.met),
    liveExecutionPermitted: false,
  };
}
