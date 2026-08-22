import {
  buildCsvImportPlan,
  parsePortfolioCsv,
  type CostBasisMethod,
  type CsvAssetResolver,
  type CsvImportPlan,
  type CsvImportSkip,
  type CsvInstrumentResolver,
  type CsvTradeRow,
} from '@coqui/core';
import {
  commitPortfolioSale,
  insertTaxLots,
  listDisposals,
  listTaxLots,
  type Db,
} from '@coqui/storage';

/**
 * CSV import (R10), as a two-step service.
 *
 * Preview and commit are separate calls over the *same* plan, because an import
 * rewrites the cost-basis book and `docs/UI-UX.md` §3.1 forbids optimistic
 * success on exactly that class of action. A user must be able to see what a
 * file will do before it does it.
 *
 * **No fingerprint table.** Duplicate protection reads the ledger the import
 * already writes: an imported lot carries its fingerprint as `externalId`, and
 * an imported disposal's id is `<fingerprint>:<index>`. So the record of what
 * has been imported *is* the lots and disposals, which cannot drift out of sync
 * with themselves the way a parallel table could.
 */

export interface CsvImportPreview {
  readonly trades: readonly CsvTradeRow[];
  readonly plan: CsvImportPlan;
  readonly parseSkipped: readonly CsvImportSkip[];
  /** Rows this file would add nothing for, because they are already imported. */
  readonly duplicateCount: number;
}

export type CsvImportCommitResult =
  | { readonly ok: true; readonly newLotCount: number; readonly disposalCount: number }
  | { readonly ok: false; readonly code: 'nothing_to_import' | 'disposal_id_conflict' };

export interface CsvImportDependencies {
  readonly database: Db;
  readonly resolveInstrument: CsvInstrumentResolver;
  readonly resolveAsset: CsvAssetResolver;
}

const DUPLICATE_REASON = 'Already imported in a previous run (duplicate skipped).';

/**
 * Everything this profile has already imported.
 *
 * Disposal ids carry the fingerprint before the first colon; a lot carries it
 * whole. Reading both means an interrupted import — lots written, disposals not
 * — still refuses to re-add the lots on the next attempt.
 */
function seenFingerprints(database: Db): ReadonlySet<string> {
  const seen = new Set<string>();
  for (const lot of listTaxLots(database)) {
    if (lot.externalId !== null) seen.add(lot.externalId);
  }
  for (const disposal of listDisposals(database)) {
    const index = disposal.id.lastIndexOf(':');
    if (index > 0) seen.add(disposal.id.slice(0, index));
  }
  return seen;
}

export class PortfolioCsvImportService {
  readonly #database: Db;
  readonly #resolveInstrument: CsvInstrumentResolver;
  readonly #resolveAsset: CsvAssetResolver;

  constructor(dependencies: CsvImportDependencies) {
    this.#database = dependencies.database;
    this.#resolveInstrument = dependencies.resolveInstrument;
    this.#resolveAsset = dependencies.resolveAsset;
  }

  /** Build the plan without persisting anything. */
  preview(csvText: string, costBasisMethod: CostBasisMethod = 'fifo'): CsvImportPreview {
    const parsed = parsePortfolioCsv(csvText, this.#resolveInstrument);
    const plan = buildCsvImportPlan(
      parsed.trades,
      listTaxLots(this.#database, true),
      seenFingerprints(this.#database),
      costBasisMethod,
      this.#resolveAsset,
    );
    return Object.freeze({
      trades: parsed.trades,
      plan,
      parseSkipped: parsed.skipped,
      duplicateCount: plan.skipped.filter((entry) => entry.reason === DUPLICATE_REASON).length,
    });
  }

  /**
   * Persist a previewed plan.
   *
   * The plan is rebuilt here rather than passed in. A plan computed against a
   * book that has since changed would write lot balances derived from stale
   * state, and the window between preview and commit is exactly where a
   * scheduled sync could land.
   */
  commit(csvText: string, costBasisMethod: CostBasisMethod = 'fifo'): CsvImportCommitResult {
    const { plan } = this.preview(csvText, costBasisMethod);
    if (plan.newLotCount === 0 && plan.newDisposals.length === 0) {
      return { ok: false, code: 'nothing_to_import' };
    }

    const existing = new Set(listTaxLots(this.#database, true).map((lot) => lot.id));
    const newLots = plan.updatedOpenLots.filter((lot) => !existing.has(lot.id));

    // Lots first: an acquisition with no matching disposal is a recoverable
    // state, while a disposal against a lot that was never written is not.
    if (newLots.length > 0) insertTaxLots(newLots, this.#database);

    if (plan.newDisposals.length > 0) {
      const updates = plan.updatedOpenLots
        .filter((lot) => existing.has(lot.id))
        .map((lot) => ({ id: lot.id, remaining: lot.remaining }));
      // Lots fully consumed by an imported sell keep a row with zero remaining
      // rather than being deleted: invariant 8's spirit, and a deleted
      // acquisition would take its cost basis with it.
      const consumed = plan.deletedLotIds.map((id) => ({ id, remaining: '0' }));
      const result = commitPortfolioSale(
        [...updates, ...consumed],
        plan.newDisposals,
        this.#database,
      );
      if (result.status === 'disposal_id_conflict') {
        return { ok: false, code: 'disposal_id_conflict' };
      }
    }

    return {
      ok: true,
      newLotCount: newLots.length,
      disposalCount: plan.newDisposals.length,
    };
  }
}
