import { sha256Hex } from '@coqui/core';

import type { Db } from '../sqlite/index.js';

/**
 * Resolutions for reconciliation exceptions — append-only, like the evidence.
 *
 * The discrepancy rows themselves are immutable by trigger (migration 42): what
 * the venue reported is a fact. A resolution is what the *user* decided about
 * that fact, so it is a separate row pointing at it. Superseding a decision
 * appends another; nothing is ever edited, and the history of what was believed
 * when stays readable.
 */

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const HASH = /^[0-9a-f]{64}$/u;

/**
 * The invariant-12 boundary, in the type system as well as the CHECK.
 *
 * Every member leaves the tax lots exactly as they are. There is deliberately
 * no member that mints a zero-basis lot or rescales existing ones — the
 * predecessor did both, and a lot invented to make a balance agree is a
 * fabricated cost basis that later shows up as a fabricated gain.
 */
export type ReconciliationResolutionKind =
  | 'external_transfer_in'
  | 'external_transfer_out'
  | 'matched_to_lot'
  | 'provider_error'
  | 'investigating';

export interface ReconciliationResolution {
  readonly id: string;
  readonly profileId: string;
  readonly discrepancyId: string;
  readonly kind: ReconciliationResolutionKind;
  /** Set only by `matched_to_lot`; the lot must already exist. */
  readonly linkedLotId: string | null;
  readonly note: string;
  readonly decidedAt: number;
}

export interface ReconciliationResolutionInput {
  readonly profileId: string;
  readonly discrepancyId: string;
  readonly kind: ReconciliationResolutionKind;
  readonly linkedLotId?: string | null;
  readonly note: string;
  readonly decidedAt: number;
}

function rowToResolution(row: Record<string, unknown>): ReconciliationResolution {
  return Object.freeze({
    id: String(row['id']),
    profileId: String(row['profile_id']),
    discrepancyId: String(row['discrepancy_id']),
    kind: String(row['kind']) as ReconciliationResolutionKind,
    linkedLotId: row['linked_lot_id'] === null ? null : String(row['linked_lot_id']),
    note: String(row['note']),
    decidedAt: Number(row['decided_at']),
  });
}

/**
 * Append one resolution.
 *
 * Idempotent by id: the id is derived from the decision's own content, so
 * recording the same decision twice is a no-op rather than a duplicate. A
 * *different* decision about the same exception hashes differently and is
 * appended, which is how superseding works.
 */
export function appendReconciliationResolution(
  input: ReconciliationResolutionInput,
  database: Db,
): ReconciliationResolution {
  if (!PROFILE_ID.test(input.profileId)) {
    throw new TypeError('Reconciliation resolutions require a known profile identifier.');
  }
  if (!HASH.test(input.discrepancyId)) {
    throw new TypeError('A reconciliation resolution must reference a discrepancy digest.');
  }
  const note = input.note.trim();
  if (note.length === 0 || note.length > 500) {
    // A resolution with no explanation is indistinguishable from dismissing the
    // exception, which is the behaviour this ledger exists to prevent.
    throw new RangeError('A reconciliation resolution requires a note of 1-500 characters.');
  }
  if (!Number.isSafeInteger(input.decidedAt) || input.decidedAt < 0) {
    throw new RangeError('A reconciliation resolution requires a safe epoch millisecond.');
  }
  const linkedLotId = input.linkedLotId ?? null;
  if ((input.kind === 'matched_to_lot') !== (linkedLotId !== null)) {
    throw new TypeError('Only matched_to_lot carries a lot, and it must carry one.');
  }

  const id = sha256Hex(
    `reconciliation:${input.profileId}:${input.discrepancyId}:${input.kind}:${linkedLotId ?? ''}:${note}`,
  );
  database.prepare(
    `INSERT OR IGNORE INTO reconciliation_resolutions_v1
     (id, profile_id, discrepancy_id, kind, linked_lot_id, note, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.profileId, input.discrepancyId, input.kind, linkedLotId, note, input.decidedAt);

  return Object.freeze({
    id,
    profileId: input.profileId,
    discrepancyId: input.discrepancyId,
    kind: input.kind,
    linkedLotId,
    note,
    decidedAt: input.decidedAt,
  });
}

/** Every decision recorded about one exception, newest first. */
export function listReconciliationResolutions(
  discrepancyId: string,
  database: Db,
  limit = 50,
): readonly ReconciliationResolution[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('Reconciliation resolution limit must be in [1, 500].');
  }
  const rows = database.prepare(
    `SELECT * FROM reconciliation_resolutions_v1 WHERE discrepancy_id = ?
     ORDER BY decided_at DESC, id LIMIT ?`,
  ).all(discrepancyId, limit) as Array<Record<string, unknown>>;
  return Object.freeze(rows.map(rowToResolution));
}

/**
 * The current decision for each exception a profile has resolved.
 *
 * Newest by `decided_at` wins, with the id breaking a tie so the answer is
 * stable rather than dependent on insertion order.
 */
export function latestReconciliationResolutions(
  profileId: string,
  database: Db,
  limit = 500,
): ReadonlyMap<string, ReconciliationResolution> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_000) {
    throw new RangeError('Reconciliation resolution limit must be in [1, 2000].');
  }
  const rows = database.prepare(
    `SELECT r.* FROM reconciliation_resolutions_v1 r
     JOIN (
       SELECT discrepancy_id, MAX(decided_at) AS decided_at
       FROM reconciliation_resolutions_v1 WHERE profile_id = ?
       GROUP BY discrepancy_id
     ) newest
       ON newest.discrepancy_id = r.discrepancy_id
      AND newest.decided_at = r.decided_at
     WHERE r.profile_id = ?
     ORDER BY r.discrepancy_id, r.id
     LIMIT ?`,
  ).all(profileId, profileId, limit) as Array<Record<string, unknown>>;

  const latest = new Map<string, ReconciliationResolution>();
  for (const row of rows) {
    const resolution = rowToResolution(row);
    // Rows arrive ordered by id within a discrepancy, so the first of a tie
    // wins and the result does not depend on insertion order.
    if (!latest.has(resolution.discrepancyId)) latest.set(resolution.discrepancyId, resolution);
  }
  return latest;
}
