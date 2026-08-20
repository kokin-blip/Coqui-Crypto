import {
  compareSaleTax,
  disposalYears,
  disposeLots,
  instrumentKey,
  nonNegativeDecimal,
  summarizeDisposals,
  type Clock,
  type CostBasisMethod,
  type Disposal,
  type InstrumentIdentity,
  type SaleTaxComparison,
  type TaxRateAssumption,
  type TaxSummary,
} from '@coqui/core';
import {
  commitPortfolioSale,
  listDisposals,
  listTaxLots,
  type Db,
  type TaxLotRemainingUpdate,
} from '@coqui/storage';
import { freezeValue } from './immutable.js';

const ZERO_DECIMAL = /^0(?:\.0+)?$/u;
const COST_BASIS_METHODS = new Set<CostBasisMethod>(['fifo', 'lifo', 'hifo', 'average']);

export interface PortfolioTaxDependencies {
  readonly database: Db;
  readonly clock: Clock;
}

export interface RecordPortfolioSaleInput {
  readonly instrument: InstrumentIdentity;
  readonly quantity: string;
  readonly proceedsUsd: string;
  readonly method: CostBasisMethod;
  readonly disposedAt?: number;
}

export type RecordPortfolioSaleFailureCode =
  | 'invalid_instrument'
  | 'invalid_quantity'
  | 'invalid_proceeds'
  | 'invalid_method'
  | 'invalid_disposed_at'
  | 'insufficient_quantity'
  | 'disposal_id_conflict';

export type RecordPortfolioSaleResult =
  | {
      readonly ok: true;
      readonly disposals: readonly Disposal[];
      readonly tax: PortfolioTaxView;
    }
  | {
      readonly ok: false;
      readonly reasonCode: RecordPortfolioSaleFailureCode;
      readonly shortfall?: string;
    };

export interface PreviewPortfolioSaleInput extends RecordPortfolioSaleInput {
  readonly rates: TaxRateAssumption;
}

export type PreviewPortfolioSaleResult =
  | {
      readonly ok: true;
      readonly asOfMs: number;
      readonly rates: TaxRateAssumption;
      readonly comparison: SaleTaxComparison;
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        | Exclude<RecordPortfolioSaleFailureCode, 'disposal_id_conflict'>
        | 'invalid_tax_rates';
      readonly shortfall?: string;
    };

export interface PortfolioTaxView {
  readonly asOfMs: number;
  readonly disposals: readonly Disposal[];
  readonly summary: TaxSummary;
  readonly years: readonly number[];
}

function validInstrument(instrument: InstrumentIdentity): boolean {
  try {
    instrumentKey(instrument);
  } catch {
    return false;
  }
  return instrument.venue === 'coinbase' && instrument.productType === 'spot';
}

function positiveDecimal(value: string): ReturnType<typeof nonNegativeDecimal> | null {
  try {
    const exact = nonNegativeDecimal(value);
    return ZERO_DECIMAL.test(exact) ? null : exact;
  } catch {
    return null;
  }
}

function nonNegative(value: string): ReturnType<typeof nonNegativeDecimal> | null {
  try {
    return nonNegativeDecimal(value);
  } catch {
    return null;
  }
}

function validRates(rates: TaxRateAssumption): boolean {
  return Number.isFinite(rates.shortTermPct) &&
    rates.shortTermPct >= 0 &&
    rates.shortTermPct <= 100 &&
    Number.isFinite(rates.longTermPct) &&
    rates.longTermPct >= 0 &&
    rates.longTermPct <= 100;
}

interface ValidatedSale {
  readonly instrument: InstrumentIdentity;
  readonly quantity: ReturnType<typeof nonNegativeDecimal>;
  readonly proceedsUsd: ReturnType<typeof nonNegativeDecimal>;
  readonly method: CostBasisMethod;
  readonly disposedAt: number;
}

type SaleValidationResult =
  | { readonly ok: true; readonly sale: ValidatedSale }
  | {
      readonly ok: false;
      readonly reasonCode: Exclude<RecordPortfolioSaleFailureCode, 'insufficient_quantity' | 'disposal_id_conflict'>;
    };

/** Atomic disposal orchestration and immutable tax evidence over explicit lots. */
export class PortfolioTaxService {
  readonly #database: Db;
  readonly #clock: Clock;

  constructor(dependencies: PortfolioTaxDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
  }

  #validate(input: RecordPortfolioSaleInput): SaleValidationResult {
    if (!validInstrument(input.instrument)) return { ok: false, reasonCode: 'invalid_instrument' };
    const quantity = positiveDecimal(input.quantity);
    if (quantity === null) return { ok: false, reasonCode: 'invalid_quantity' };
    const proceedsUsd = nonNegative(input.proceedsUsd);
    if (proceedsUsd === null) return { ok: false, reasonCode: 'invalid_proceeds' };
    if (!COST_BASIS_METHODS.has(input.method)) return { ok: false, reasonCode: 'invalid_method' };
    const disposedAt = input.disposedAt ?? this.#clock.nowMs();
    if (
      !Number.isSafeInteger(disposedAt) ||
      disposedAt < 0 ||
      disposedAt > this.#clock.nowMs()
    ) return { ok: false, reasonCode: 'invalid_disposed_at' };
    return {
      ok: true,
      sale: { instrument: input.instrument, quantity, proceedsUsd, method: input.method, disposedAt },
    };
  }

  #eligibleLots(sale: ValidatedSale) {
    const target = instrumentKey(sale.instrument);
    return listTaxLots(this.#database, true).filter(
      (lot) =>
        instrumentKey(lot.asset.instrument) === target &&
        lot.acquiredAt <= sale.disposedAt,
    );
  }

  recordSale(input: RecordPortfolioSaleInput): RecordPortfolioSaleResult {
    const validated = this.#validate(input);
    if (!validated.ok) return validated;
    const openLots = this.#eligibleLots(validated.sale);
    const result = disposeLots(
      openLots,
      validated.sale.instrument,
      validated.sale.quantity,
      validated.sale.proceedsUsd,
      validated.sale.method,
      validated.sale.disposedAt,
      'manual',
    );
    if (!ZERO_DECIMAL.test(result.shortfall)) {
      return { ok: false, reasonCode: 'insufficient_quantity', shortfall: result.shortfall };
    }

    const remaining = new Map(result.updatedLots.map((lot) => [lot.id, lot.remaining]));
    const updates: TaxLotRemainingUpdate[] = openLots.map((lot) => ({
      id: lot.id,
      remaining: remaining.get(lot.id) ?? '0',
    }));
    const commit = commitPortfolioSale(updates, result.disposals, this.#database);
    if (commit.status === 'disposal_id_conflict') {
      return { ok: false, reasonCode: 'disposal_id_conflict' };
    }
    return freezeValue({
      ok: true as const,
      disposals: result.disposals,
      tax: this.view(),
    });
  }

  previewSale(input: PreviewPortfolioSaleInput): PreviewPortfolioSaleResult {
    const validated = this.#validate(input);
    if (!validated.ok) return validated;
    if (!validRates(input.rates)) return { ok: false, reasonCode: 'invalid_tax_rates' };
    const openLots = this.#eligibleLots(validated.sale);
    const comparison = compareSaleTax(
      openLots,
      validated.sale.instrument,
      validated.sale.quantity,
      validated.sale.proceedsUsd,
      validated.sale.method,
      input.rates,
      validated.sale.disposedAt,
    );
    const selected = comparison.previews.find(
      (preview) => preview.method === validated.sale.method,
    );
    if (!selected || !ZERO_DECIMAL.test(selected.shortfall)) {
      return {
        ok: false,
        reasonCode: 'insufficient_quantity',
        shortfall: selected?.shortfall ?? validated.sale.quantity,
      };
    }
    return freezeValue({
      ok: true as const,
      asOfMs: validated.sale.disposedAt,
      rates: { ...input.rates },
      comparison,
    });
  }

  view(): PortfolioTaxView {
    const asOfMs = this.#clock.nowMs();
    const disposals = listDisposals(this.#database);
    return freezeValue({
      asOfMs,
      disposals,
      summary: summarizeDisposals(disposals, asOfMs),
      years: disposalYears(disposals),
    });
  }
}
