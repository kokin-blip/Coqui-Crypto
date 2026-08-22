import { getTaxLot } from '@coqui/storage';
import {
  appendReconciliationResolution,
  latestReconciliationResolutions,
  listCoinbaseBalanceDiscrepancies,
  listReconciliationResolutions,
  type CoinbaseDiscrepancyEvidenceView,
  type Db,
  type ReconciliationResolution,
  type ReconciliationResolutionKind,
} from '@coqui/storage';

import type { Clock } from '@coqui/core';

/**
 * The reconciliation ledger P7 owes.
 *
 * Sync already writes *evidence* — what the venue said each balance was, and
 * where it disagreed with the local lots. What did not exist is any way to
 * record what the user decided about a disagreement, so every exception stayed
 * open forever and the screen could only list them.
 *
 * The governing rule is invariant 12: **never invent or silently resize a tax
 * lot.** An unexplained balance is an exception requiring resolution, not a
 * zero-basis lot and not a proportional rescale. The predecessor did both. So
 * the resolutions this service offers are exactly the ones that leave the lots
 * untouched, and the enum admits nothing else — a user whose balance really is
 * explained by an unrecorded acquisition records a lot with a real basis first
 * and then matches it.
 */

export type { ReconciliationResolutionKind };

export interface ReconciliationOption {
  readonly kind: ReconciliationResolutionKind;
  readonly label: string;
  /** Why this outcome is safe, in the words the surface should use. */
  readonly explanation: string;
  readonly requiresLot: boolean;
}

/**
 * Every outcome, with its justification attached.
 *
 * The explanations live here rather than in the renderer because they are
 * claims about what the application does to the ledger, and a claim like that
 * should sit next to the code that honours it.
 */
export const RECONCILIATION_OPTIONS: readonly ReconciliationOption[] = Object.freeze([
  Object.freeze({
    kind: 'external_transfer_in' as const,
    label: 'Transferred in from elsewhere',
    explanation:
      'Records that the balance arrived from outside this application. No lot is created, '
      + 'so nothing claims a cost basis it does not have. Add a lot with a real basis if you '
      + 'want the acquisition tracked.',
    requiresLot: false,
  }),
  Object.freeze({
    kind: 'external_transfer_out' as const,
    label: 'Transferred out to elsewhere',
    explanation:
      'Records that the balance left for a destination this application does not track. '
      + 'Existing lots are left exactly as they are; a transfer is not a disposal.',
    requiresLot: false,
  }),
  Object.freeze({
    kind: 'matched_to_lot' as const,
    label: 'Explained by an existing lot',
    explanation:
      'Points the exception at a lot that already exists. This records a match, never a '
      + 'creation, and the lot keeps its own basis.',
    requiresLot: true,
  }),
  Object.freeze({
    kind: 'provider_error' as const,
    label: 'The venue reported it wrong',
    explanation:
      'Records that the discrepancy is the provider’s, not yours. The evidence row stays '
      + 'exactly as received — it is what the venue said, and that remains a fact.',
    requiresLot: false,
  }),
  Object.freeze({
    kind: 'investigating' as const,
    label: 'Still investigating',
    explanation:
      'Keeps the exception open deliberately, so an unresolved balance reads as a decision '
      + 'rather than an oversight.',
    requiresLot: false,
  }),
]);

export interface ReconciliationException {
  readonly discrepancy: CoinbaseDiscrepancyEvidenceView;
  /** The current decision, or null while the exception is unresolved. */
  readonly resolution: ReconciliationResolution | null;
  /** Every decision ever recorded about it, newest first. */
  readonly history: readonly ReconciliationResolution[];
}

export interface ReconciliationLedgerView {
  readonly profileId: string;
  readonly asOfMs: number;
  readonly exceptions: readonly ReconciliationException[];
  readonly unresolvedCount: number;
  readonly options: readonly ReconciliationOption[];
}

export type ReconciliationResolveIssue =
  | 'unknown_discrepancy'
  | 'unknown_lot'
  | 'lot_required'
  | 'lot_not_allowed'
  | 'note_required';

export type ReconciliationResolveResult =
  | { readonly ok: true; readonly resolution: ReconciliationResolution }
  | { readonly ok: false; readonly code: ReconciliationResolveIssue };

export interface ReconciliationLedgerDependencies {
  readonly database: Db;
  readonly clock: Clock;
}

export interface ReconciliationResolveInput {
  readonly profileId: string;
  readonly discrepancyId: string;
  readonly kind: ReconciliationResolutionKind;
  readonly linkedLotId?: string | null;
  readonly note: string;
}

export class ReconciliationLedgerService {
  readonly #database: Db;
  readonly #clock: Clock;

  constructor(dependencies: ReconciliationLedgerDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
  }

  view(profileId: string, limit = 250): ReconciliationLedgerView {
    const discrepancies = listCoinbaseBalanceDiscrepancies(this.#database, limit);
    const latest = latestReconciliationResolutions(profileId, this.#database);

    const exceptions = discrepancies.map((discrepancy) => {
      const resolution = latest.get(discrepancy.id) ?? null;
      return Object.freeze({
        discrepancy,
        resolution,
        // Read lazily per exception rather than in one sweep: the history is
        // small, and an exception with no decision costs one indexed miss.
        history:
          resolution === null
            ? Object.freeze([])
            : listReconciliationResolutions(discrepancy.id, this.#database),
      });
    });

    return Object.freeze({
      profileId,
      asOfMs: this.#clock.nowMs(),
      exceptions: Object.freeze(exceptions),
      // `investigating` is a decision, but it is not a resolution — an exception
      // parked deliberately is still unresolved, and the count must say so.
      unresolvedCount: exceptions.filter(
        (exception) =>
          exception.resolution === null || exception.resolution.kind === 'investigating',
      ).length,
      options: RECONCILIATION_OPTIONS,
    });
  }

  /**
   * Record a decision.
   *
   * Every failure is a typed code rather than a thrown message: this is reached
   * from IPC, and a raw error crossing that boundary risks carrying detail it
   * should not (invariant 3).
   */
  resolve(input: ReconciliationResolveInput): ReconciliationResolveResult {
    const known = listCoinbaseBalanceDiscrepancies(this.#database, 1_000)
      .some((discrepancy) => discrepancy.id === input.discrepancyId);
    // Resolving something that was never observed would put a decision in the
    // ledger with no evidence behind it.
    if (!known) return { ok: false, code: 'unknown_discrepancy' };

    const linkedLotId = input.linkedLotId ?? null;
    if (input.kind === 'matched_to_lot' && linkedLotId === null) {
      return { ok: false, code: 'lot_required' };
    }
    if (input.kind !== 'matched_to_lot' && linkedLotId !== null) {
      return { ok: false, code: 'lot_not_allowed' };
    }
    if (linkedLotId !== null && getTaxLot(linkedLotId, this.#database) === null) {
      // A match against a lot that does not exist is how a fabricated basis
      // would get in through the side door.
      return { ok: false, code: 'unknown_lot' };
    }
    if (input.note.trim().length === 0) return { ok: false, code: 'note_required' };

    return {
      ok: true,
      resolution: appendReconciliationResolution(
        {
          profileId: input.profileId,
          discrepancyId: input.discrepancyId,
          kind: input.kind,
          linkedLotId,
          note: input.note,
          decidedAt: this.#clock.nowMs(),
        },
        this.#database,
      ),
    };
  }
}
