import { sha256Hex } from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

export type PaperExecutionPolicyMode = 'off' | 'review_required' | 'unattended';
export type PaperExecutionProposalStatus =
  | 'pending_review' | 'approved' | 'rejected' | 'executing'
  | 'blocked' | 'failed' | 'succeeded' | 'unknown';
export type PaperExecutionOutcomeStatus =
  | 'pending' | 'submitted' | 'blocked' | 'failed' | 'succeeded' | 'unknown';

export interface PaperExecutionAttemptOutcome {
  readonly status: PaperExecutionOutcomeStatus;
  readonly reasonCode: string | null;
  readonly filledCount: number;
  readonly refusedCount: number;
}

export interface PaperProposalPendingContext {
  readonly decisionId: string;
  readonly requiredExecutionBarStartMs: number;
  readonly costModelHash: string;
}

export function savePaperProposalPendingContext(
  proposalId: string,
  context: PaperProposalPendingContext,
  database: Db,
): void {
  database.prepare(`
    INSERT INTO paper_proposal_pending_context_v1
      (proposal_id, decision_id, required_bar_start, cost_model_hash)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(proposal_id) DO NOTHING
  `).run(
    proposalId, context.decisionId, context.requiredExecutionBarStartMs, context.costModelHash,
  );
  const stored = getPaperProposalPendingContext(proposalId, database);
  if (stored === null || JSON.stringify(stored) !== JSON.stringify(context)) {
    throw new Error('Paper proposal pending context cannot change.');
  }
}

export function getPaperProposalPendingContext(
  proposalId: string,
  database: Db,
): PaperProposalPendingContext | null {
  const row = database.prepare(`
    SELECT decision_id, required_bar_start, cost_model_hash
    FROM paper_proposal_pending_context_v1 WHERE proposal_id = ?
  `).get(proposalId) as {
    decision_id: string;
    required_bar_start: number;
    cost_model_hash: string;
  } | undefined;
  return row === undefined ? null : Object.freeze({
    decisionId: row.decision_id,
    requiredExecutionBarStartMs: row.required_bar_start,
    costModelHash: row.cost_model_hash,
  });
}

export interface PaperExecutionPolicyRecord {
  readonly profileId: string;
  readonly mode: PaperExecutionPolicyMode;
  readonly revision: number;
  readonly provenanceHash: string;
  readonly confirmedAt: number;
  readonly updatedAt: number;
  readonly source: 'default' | 'stored';
}

export interface PaperExecutionProposalRecord {
  readonly id: string;
  readonly profileId: string;
  readonly runId: string;
  readonly revision: number;
  readonly proposalHash: string;
  readonly intentsJson: string;
  readonly status: PaperExecutionProposalStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface PolicyRow {
  profile_id: string;
  mode: PaperExecutionPolicyMode;
  revision: number;
  provenance_hash: string;
  confirmed_at: number;
  updated_at: number;
}

interface ProposalRow {
  id: string;
  profile_id: string;
  run_id: string;
  revision: number;
  proposal_hash: string;
  intents_json: string;
  status: PaperExecutionProposalStatus;
  created_at: number;
  updated_at: number;
}

function policyFromRow(row: PolicyRow, source: 'default' | 'stored'): PaperExecutionPolicyRecord {
  return Object.freeze({
    profileId: row.profile_id,
    mode: row.mode,
    revision: row.revision,
    provenanceHash: row.provenance_hash,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
    source,
  });
}

function proposalFromRow(row: ProposalRow): PaperExecutionProposalRecord {
  return Object.freeze({
    id: row.id,
    profileId: row.profile_id,
    runId: row.run_id,
    revision: row.revision,
    proposalHash: row.proposal_hash,
    intentsJson: row.intents_json,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Absence is deliberately review-required, never unattended. */
export function getPaperExecutionPolicy(
  profileId: string,
  database: Db,
): PaperExecutionPolicyRecord {
  const row = database.prepare(
    'SELECT * FROM paper_execution_policies_v1 WHERE profile_id = ?',
  ).get(profileId) as unknown as PolicyRow | undefined;
  if (row !== undefined) return policyFromRow(row, 'stored');
  return Object.freeze({
    profileId,
    mode: 'review_required',
    revision: 0,
    provenanceHash: sha256Hex(`paper-policy:${profileId}:review_required:default`),
    confirmedAt: 0,
    updatedAt: 0,
    source: 'default',
  });
}

export interface SetPaperExecutionPolicyInput {
  readonly commandId: string;
  readonly profileId: string;
  readonly mode: PaperExecutionPolicyMode;
  readonly confirmedAt: number;
  readonly explicitUnattendedConfirmation: boolean;
}

export function setPaperExecutionPolicy(
  input: SetPaperExecutionPolicyInput,
  database: Db,
): PaperExecutionPolicyRecord {
  if (input.mode === 'unattended' && !input.explicitUnattendedConfirmation) {
    throw new Error('Unattended paper execution requires explicit confirmation.');
  }
  return inTransaction(database, () => {
    const duplicate = database.prepare(
      `SELECT profile_id, mode, revision, provenance_hash, confirmed_at,
              confirmed_at AS updated_at
       FROM paper_execution_policy_events_v1 WHERE command_id = ?`,
    ).get(input.commandId) as unknown as PolicyRow | undefined;
    if (duplicate !== undefined) return policyFromRow(duplicate, 'stored');

    const prior = getPaperExecutionPolicy(input.profileId, database);
    const revision = prior.revision + 1;
    const provenanceHash = sha256Hex(
      `${input.commandId}:${input.profileId}:${input.mode}:${revision}:${input.confirmedAt}`,
    );
    database.prepare(`
      INSERT INTO paper_execution_policies_v1
        (profile_id, mode, revision, provenance_hash, confirmed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        mode = excluded.mode,
        revision = excluded.revision,
        provenance_hash = excluded.provenance_hash,
        confirmed_at = excluded.confirmed_at,
        updated_at = excluded.updated_at
    `).run(input.profileId, input.mode, revision, provenanceHash, input.confirmedAt, input.confirmedAt);
    database.prepare(`
      INSERT INTO paper_execution_policy_events_v1
        (id, command_id, profile_id, mode, revision, provenance_hash, confirmed_at, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sha256Hex(`paper-policy-event:${input.commandId}`),
      input.commandId,
      input.profileId,
      input.mode,
      revision,
      provenanceHash,
      input.confirmedAt,
      JSON.stringify({ paperOnly: true, explicitUnattendedConfirmation: input.explicitUnattendedConfirmation }),
    );
    return getPaperExecutionPolicy(input.profileId, database);
  });
}

export function getPaperExecutionProposal(
  id: string,
  database: Db,
): PaperExecutionProposalRecord | null {
  const row = database.prepare(
    'SELECT * FROM paper_execution_proposals_v1 WHERE id = ?',
  ).get(id) as unknown as ProposalRow | undefined;
  return row === undefined ? null : proposalFromRow(row);
}

export function listPaperExecutionProposals(
  profileId: string,
  limit: number,
  database: Db,
): readonly PaperExecutionProposalRecord[] {
  const bounded = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = database.prepare(`
    SELECT * FROM paper_execution_proposals_v1
    WHERE profile_id = ?
    ORDER BY updated_at DESC, id
    LIMIT ?
  `).all(profileId, bounded) as unknown as ProposalRow[];
  return Object.freeze(rows.map(proposalFromRow));
}

export function getLatestPaperExecutionReview(
  proposalId: string,
  database: Db,
): {
  readonly decision: 'human_approved' | 'human_rejected' | 'system_not_required';
  readonly reviewer: string;
  readonly note: string;
  readonly decidedAt: number;
} | null {
  const row = database.prepare(`
    SELECT decision, reviewer, note, decided_at
    FROM paper_execution_reviews_v1
    WHERE proposal_id = ?
    ORDER BY decided_at DESC, id DESC
    LIMIT 1
  `).get(proposalId) as unknown as {
    decision: 'human_approved' | 'human_rejected' | 'system_not_required';
    reviewer: string;
    note: string;
    decided_at: number;
  } | undefined;
  return row === undefined ? null : Object.freeze({
    decision: row.decision,
    reviewer: row.reviewer,
    note: row.note,
    decidedAt: row.decided_at,
  });
}

export function savePaperExecutionProposal(
  proposal: PaperExecutionProposalRecord,
  database: Db,
): PaperExecutionProposalRecord {
  JSON.parse(proposal.intentsJson) as unknown;
  const prior = getPaperExecutionProposal(proposal.id, database);
  if (prior !== null) {
    const same = prior.profileId === proposal.profileId && prior.runId === proposal.runId
      && prior.revision === proposal.revision && prior.proposalHash === proposal.proposalHash
      && prior.intentsJson === proposal.intentsJson;
    if (!same) throw new Error('A paper proposal identity cannot change after persistence.');
    return prior;
  }
  database.prepare(`
    INSERT INTO paper_execution_proposals_v1
      (id, profile_id, run_id, revision, proposal_hash, intents_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    proposal.id, proposal.profileId, proposal.runId, proposal.revision,
    proposal.proposalHash, proposal.intentsJson, proposal.status,
    proposal.createdAt, proposal.updatedAt,
  );
  return getPaperExecutionProposal(proposal.id, database)!;
}

export function updatePaperExecutionProposalStatus(
  id: string,
  status: PaperExecutionProposalStatus,
  at: number,
  database: Db,
): PaperExecutionProposalRecord {
  const changed = database.prepare(
    'UPDATE paper_execution_proposals_v1 SET status = ?, updated_at = ? WHERE id = ?',
  ).run(status, at, id);
  if (changed.changes !== 1) throw new Error('Paper execution proposal not found.');
  return getPaperExecutionProposal(id, database)!;
}

export function appendPaperExecutionEvent(
  proposalId: string,
  profileId: string,
  kind: 'prepared' | 'reviewed' | 'submission_started' | 'blocked' | 'failed' | 'succeeded' | 'unknown',
  at: number,
  detail: Readonly<Record<string, unknown>>,
  database: Db,
): void {
  const row = database.prepare(
    'SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM paper_execution_events_v1 WHERE proposal_id = ?',
  ).get(proposalId) as unknown as { sequence: number };
  database.prepare(`
    INSERT INTO paper_execution_events_v1
      (id, proposal_id, profile_id, sequence, kind, at, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sha256Hex(`${proposalId}:event:${row.sequence}`), proposalId, profileId,
    row.sequence, kind, at, JSON.stringify({ paperOnly: true, ...detail }),
  );
}

export function recordPaperExecutionReview(
  input: {
    readonly commandId: string;
    readonly proposal: PaperExecutionProposalRecord;
    readonly decision: 'human_approved' | 'human_rejected' | 'system_not_required';
    readonly reviewer: string;
    readonly note: string;
    readonly decidedAt: number;
  },
  database: Db,
): void {
  database.prepare(`
    INSERT OR IGNORE INTO paper_execution_reviews_v1
      (id, command_id, proposal_id, profile_id, proposal_hash, decision, reviewer, note, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sha256Hex(`paper-review:${input.commandId}`), input.commandId, input.proposal.id,
    input.proposal.profileId, input.proposal.proposalHash, input.decision,
    input.reviewer, input.note, input.decidedAt,
  );
}

export function recordPaperExecutionAttempt(
  input: {
    readonly id: string;
    readonly commandId: string;
    readonly proposal: PaperExecutionProposalRecord;
    readonly status: PaperExecutionOutcomeStatus;
    readonly reasonCode: string | null;
    readonly filledCount: number;
    readonly refusedCount: number;
    readonly checkSnapshotHash: string;
    readonly checkSnapshotJson: string;
    readonly startedAt: number;
    readonly completedAt: number | null;
  },
  database: Db,
): PaperExecutionAttemptOutcome {
  JSON.parse(input.checkSnapshotJson) as unknown;
  const duplicate = database.prepare(
    'SELECT outcome_json FROM paper_execution_attempts_v1 WHERE command_id = ?',
  ).get(input.commandId) as unknown as { outcome_json: string } | undefined;
  if (duplicate !== undefined) {
    return Object.freeze(JSON.parse(duplicate.outcome_json) as PaperExecutionAttemptOutcome);
  }
  const outcome = Object.freeze({
    status: input.status,
    reasonCode: input.reasonCode,
    filledCount: input.filledCount,
    refusedCount: input.refusedCount,
  });
  database.prepare(`
    INSERT INTO paper_execution_attempts_v1
      (id, command_id, proposal_id, profile_id, proposal_hash, status, outcome_json,
       check_snapshot_hash, check_snapshot_json, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id, input.commandId, input.proposal.id, input.proposal.profileId,
    input.proposal.proposalHash, input.status, JSON.stringify(outcome), input.checkSnapshotHash,
    input.checkSnapshotJson, input.startedAt, input.completedAt,
  );
  return outcome;
}

export function getPaperExecutionAttemptOutcome(
  commandId: string,
  database: Db,
): PaperExecutionAttemptOutcome | null {
  const row = database.prepare(
    'SELECT outcome_json FROM paper_execution_attempts_v1 WHERE command_id = ?',
  ).get(commandId) as unknown as { outcome_json: string } | undefined;
  return row === undefined
    ? null
    : Object.freeze(JSON.parse(row.outcome_json) as PaperExecutionAttemptOutcome);
}
