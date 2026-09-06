import {
  sha256Hex,
  type ExecutionIntent,
  type Holding,
  type MarketQualitySnapshot,
  type RiskControlInput,
} from '@coqui/core';
import {
  appendPaperExecutionEvent,
  getPaperExecutionAttemptOutcome,
  getPaperExecutionPolicy,
  getPaperExecutionProposal,
  getPaperProposalPendingContext,
  recordPaperExecutionAttempt,
  recordPaperExecutionReview,
  savePaperExecutionProposal,
  savePaperProposalPendingContext,
  updatePaperExecutionProposalStatus,
  type Db,
  type PaperExecutionOutcomeStatus,
  type PaperExecutionProposalRecord,
} from '@coqui/storage';

import { isApproved, runExecutionGates, type ExecutionRefusalCode } from './execution-gate.js';
import {
  PaperOmsService,
  type PaperMarketData,
  type PaperPendingSettlementResult,
} from './oms.js';

export interface PaperExecutionState {
  readonly holdings: readonly Holding[];
  readonly killSwitchEngaged: boolean;
  readonly evidenceVerified: boolean;
  readonly historicalGrossEdgeLowerBoundPct: number;
  readonly riskInput?: RiskControlInput;
  readonly marketQuality?: MarketQualitySnapshot | null;
}

export interface ProposedPaperAction {
  readonly proposalId: string;
  readonly runId: string;
  readonly revision: number;
  readonly intents: readonly ExecutionIntent[];
  readonly pending?: {
    readonly decisionId: string;
    readonly requiredExecutionBarStartMs: number;
    readonly costModelHash: string;
  };
}

export interface PaperExecutionResult {
  readonly status: PaperExecutionOutcomeStatus;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly reasonCode: string | null;
  readonly filledCount: number;
  readonly refusedCount: number;
}

export interface PaperExecutionDependencies {
  readonly database: Db;
  readonly profileId: string;
  readonly nowMs: () => number;
  readonly market: PaperMarketData;
  /** Read at preflight and again at submission; callers cannot pass a stale snapshot. */
  readonly state: () => PaperExecutionState;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
}

function serializedIntents(intents: readonly ExecutionIntent[]): string {
  return JSON.stringify(intents);
}

function proposalHash(
  profileId: string,
  action: ProposedPaperAction,
  intentsJson: string,
): string {
  return sha256Hex(`${profileId}:${action.runId}:${action.revision}:${intentsJson}`);
}

function result(
  proposal: PaperExecutionProposalRecord,
  status: PaperExecutionOutcomeStatus,
  reasonCode: string | null,
  filledCount = 0,
  refusedCount = 0,
): PaperExecutionResult {
  return Object.freeze({
    status,
    proposalId: proposal.id,
    proposalHash: proposal.proposalHash,
    reasonCode,
    filledCount,
    refusedCount,
  });
}

/** The sole production boundary allowed to reach paper OMS persistence. */
export class PaperExecutionService {
  readonly #database: Db;
  readonly #profileId: string;
  readonly #nowMs: () => number;
  readonly #market: PaperMarketData;
  readonly #state: () => PaperExecutionState;
  readonly #onUnexpectedError: (context: string, error: unknown) => void;

  constructor(dependencies: PaperExecutionDependencies) {
    this.#database = dependencies.database;
    this.#profileId = dependencies.profileId;
    this.#nowMs = dependencies.nowMs;
    this.#market = dependencies.market;
    this.#state = dependencies.state;
    this.#onUnexpectedError = dependencies.onUnexpectedError ?? (() => {});
  }

  /** Reconcile durable simulator submissions through the same sole OMS boundary. */
  settlePending(): PaperPendingSettlementResult {
    return new PaperOmsService({
      database: this.#database,
      clock: { nowMs: this.#nowMs },
      market: this.#market,
      onUnexpectedError: (productId, error) =>
        this.#onUnexpectedError(`paper_settlement:${productId}`, error),
    }).settlePending(this.#profileId);
  }

  prepare(action: ProposedPaperAction): PaperExecutionResult {
    const at = this.#nowMs();
    const intentsJson = serializedIntents(action.intents);
    const hash = proposalHash(this.#profileId, action, intentsJson);
    const policy = getPaperExecutionPolicy(this.#profileId, this.#database);
    const snapshot = this.#state();
    let reasonCode: string | null = null;

    if (policy.mode === 'off') reasonCode = 'paper_execution_off';
    else if (!snapshot.evidenceVerified) reasonCode = 'evidence_not_verified';

    const gates = reasonCode === null
      ? runExecutionGates({
          profileId: this.#profileId,
          runId: action.runId,
          nowMs: at,
          mode: 'paper',
          killSwitchEngaged: snapshot.killSwitchEngaged,
          intents: action.intents,
          holdings: snapshot.holdings,
          historicalGrossEdgeLowerBoundPct: snapshot.historicalGrossEdgeLowerBoundPct,
          ...(snapshot.riskInput === undefined ? {} : { riskInput: snapshot.riskInput }),
          ...(snapshot.marketQuality === undefined ? {} : { marketQuality: snapshot.marketQuality }),
        })
      : null;
    if (gates !== null && !isApproved(gates)) reasonCode = gates.code;

    const proposal = savePaperExecutionProposal({
      id: action.proposalId,
      profileId: this.#profileId,
      runId: action.runId,
      revision: action.revision,
      proposalHash: hash,
      intentsJson,
      status: reasonCode === null ? 'pending_review' : 'blocked',
      createdAt: at,
      updatedAt: at,
    }, this.#database);
    if (action.pending !== undefined) {
      savePaperProposalPendingContext(proposal.id, action.pending, this.#database);
    }
    appendPaperExecutionEvent(proposal.id, this.#profileId, 'prepared', at, {
      proposalHash: hash,
      policy: policy.mode,
      reasonCode,
    }, this.#database);

    if (reasonCode !== null) return result(proposal, 'blocked', reasonCode);
    if (policy.mode === 'review_required') return result(proposal, 'pending', 'human_review_required');

    const commandId = sha256Hex(`unattended:${proposal.id}:${proposal.proposalHash}`);
    recordPaperExecutionReview({
      commandId,
      proposal,
      decision: 'system_not_required',
      reviewer: 'explicit unattended policy',
      note: `policy provenance ${policy.provenanceHash}`,
      decidedAt: at,
    }, this.#database);
    return this.#submit(proposal, commandId);
  }

  review(input: {
    readonly commandId: string;
    readonly proposalId: string;
    readonly proposalHash: string;
    readonly decision: 'approve' | 'reject';
    readonly reviewer: string;
    readonly note: string;
  }): PaperExecutionResult {
    const proposal = getPaperExecutionProposal(input.proposalId, this.#database);
    if (proposal === null) {
      return Object.freeze({
        status: 'failed', proposalId: input.proposalId, proposalHash: input.proposalHash,
        reasonCode: 'proposal_not_found', filledCount: 0, refusedCount: 0,
      });
    }
    if (proposal.profileId !== this.#profileId || proposal.proposalHash !== input.proposalHash) {
      return result(proposal, 'blocked', 'stale_proposal_review');
    }
    const at = this.#nowMs();
    recordPaperExecutionReview({
      commandId: input.commandId,
      proposal,
      decision: input.decision === 'approve' ? 'human_approved' : 'human_rejected',
      reviewer: input.reviewer,
      note: input.note,
      decidedAt: at,
    }, this.#database);
    appendPaperExecutionEvent(proposal.id, this.#profileId, 'reviewed', at, {
      decision: input.decision,
      proposalHash: input.proposalHash,
    }, this.#database);
    if (input.decision === 'reject') {
      const rejected = updatePaperExecutionProposalStatus(proposal.id, 'rejected', at, this.#database);
      return result(rejected, 'blocked', 'human_rejected');
    }
    return this.#submit(proposal, input.commandId);
  }

  #submit(proposal: PaperExecutionProposalRecord, commandId: string): PaperExecutionResult {
    const duplicate = getPaperExecutionAttemptOutcome(commandId, this.#database);
    if (duplicate !== null) {
      return result(
        proposal,
        duplicate.status,
        duplicate.reasonCode,
        duplicate.filledCount,
        duplicate.refusedCount,
      );
    }

    const at = this.#nowMs();
    const policy = getPaperExecutionPolicy(this.#profileId, this.#database);
    const snapshot = this.#state();
    const intents = JSON.parse(proposal.intentsJson) as readonly ExecutionIntent[];
    let refusal: ExecutionRefusalCode | 'paper_execution_off' | 'evidence_not_verified' | null = null;
    if (policy.mode === 'off') refusal = 'paper_execution_off';
    else if (!snapshot.evidenceVerified) refusal = 'evidence_not_verified';
    const gates = refusal === null
      ? runExecutionGates({
          profileId: this.#profileId,
          runId: proposal.runId,
          nowMs: at,
          mode: 'paper',
          killSwitchEngaged: snapshot.killSwitchEngaged,
          intents,
          holdings: snapshot.holdings,
          historicalGrossEdgeLowerBoundPct: snapshot.historicalGrossEdgeLowerBoundPct,
          ...(snapshot.riskInput === undefined ? {} : { riskInput: snapshot.riskInput }),
          ...(snapshot.marketQuality === undefined ? {} : { marketQuality: snapshot.marketQuality }),
        })
      : null;
    if (gates !== null && !isApproved(gates)) refusal = gates.code;
    const checkSnapshotJson = JSON.stringify({
      paperOnly: true,
      proposalHash: proposal.proposalHash,
      policy: policy.mode,
      policyProvenanceHash: policy.provenanceHash,
      evidenceVerified: snapshot.evidenceVerified,
      killSwitchEngaged: snapshot.killSwitchEngaged,
      refusal,
    });
    const checkSnapshotHash = sha256Hex(checkSnapshotJson);

    if (refusal !== null || gates === null || !isApproved(gates)) {
      recordPaperExecutionAttempt({
        id: sha256Hex(`paper-attempt:${commandId}`), commandId, proposal,
        status: 'blocked', reasonCode: refusal, filledCount: 0, refusedCount: 0,
        checkSnapshotHash, checkSnapshotJson,
        startedAt: at, completedAt: at,
      }, this.#database);
      updatePaperExecutionProposalStatus(proposal.id, 'blocked', at, this.#database);
      appendPaperExecutionEvent(proposal.id, this.#profileId, 'blocked', at, {
        reasonCode: refusal,
        checkSnapshotHash,
      }, this.#database);
      return result(proposal, 'blocked', refusal);
    }

    updatePaperExecutionProposalStatus(proposal.id, 'executing', at, this.#database);
    appendPaperExecutionEvent(proposal.id, this.#profileId, 'submission_started', at, {
      checkSnapshotHash,
    }, this.#database);
    const oms = new PaperOmsService({
      database: this.#database,
      clock: { nowMs: this.#nowMs },
      market: this.#market,
      onUnexpectedError: (productId, error) => this.#onUnexpectedError(`oms:${productId}`, error),
    });
    const pending = getPaperProposalPendingContext(proposal.id, this.#database);
    if (pending !== null) {
      const submitted = oms.submitPending(gates, pending);
      const status: PaperExecutionOutcomeStatus = submitted.submittedCount > 0
        ? 'submitted'
        : 'blocked';
      const completedAt = this.#nowMs();
      recordPaperExecutionAttempt({
        id: sha256Hex(`paper-attempt:${commandId}`), commandId, proposal, status,
        reasonCode: submitted.submittedCount > 0 ? null : 'venue_refused',
        filledCount: 0, refusedCount: submitted.refusedCount,
        checkSnapshotHash, checkSnapshotJson, startedAt: at, completedAt,
      }, this.#database);
      updatePaperExecutionProposalStatus(
        proposal.id, submitted.submittedCount > 0 ? 'executing' : 'blocked', completedAt, this.#database,
      );
      appendPaperExecutionEvent(proposal.id, this.#profileId,
        submitted.submittedCount > 0 ? 'submission_started' : 'blocked', completedAt,
        { submittedCount: submitted.submittedCount, orderIds: submitted.orderIds }, this.#database);
      return result(proposal, status, submitted.submittedCount > 0 ? null : 'venue_refused',
        0, submitted.refusedCount);
    }
    const settled = oms.execute(gates);
    const hasUnknown = settled.orders.some((order) => order.finalState === 'unknown');
    const status: PaperExecutionOutcomeStatus = hasUnknown
      ? 'unknown'
      : settled.filledCount > 0 ? 'succeeded' : 'blocked';
    const completedAt = this.#nowMs();
    recordPaperExecutionAttempt({
      id: sha256Hex(`paper-attempt:${commandId}`), commandId, proposal,
      status,
      reasonCode: hasUnknown ? 'ambiguous_outcome' : settled.filledCount === 0 ? 'venue_refused' : null,
      filledCount: settled.filledCount,
      refusedCount: settled.refusedCount,
      checkSnapshotHash, checkSnapshotJson, startedAt: at, completedAt,
    }, this.#database);
    updatePaperExecutionProposalStatus(proposal.id, status, completedAt, this.#database);
    appendPaperExecutionEvent(
      proposal.id,
      this.#profileId,
      status === 'succeeded' ? 'succeeded' : status === 'unknown' ? 'unknown' : 'blocked',
      completedAt,
      { filledCount: settled.filledCount, refusedCount: settled.refusedCount, checkSnapshotHash },
      this.#database,
    );
    return result(
      proposal,
      status,
      hasUnknown ? 'ambiguous_outcome' : settled.filledCount === 0 ? 'venue_refused' : null,
      settled.filledCount,
      settled.refusedCount,
    );
  }
}
