import { Decimal } from 'decimal.js';
import { disposeLots } from './costbasis.js';
import {
  decimal,
  type AssetQuantity,
  type CostBasisMethod,
  type DecimalString,
  type InstrumentIdentity,
  type TaxLot,
  type UsdAmount,
} from '../types/index.js';

export interface TaxRateAssumption {
  /** Marginal percentage on short-term gains. */
  shortTermPct: number;
  /** Percentage on long-term gains. */
  longTermPct: number;
}

export const DEFAULT_TAX_RATES: TaxRateAssumption = { shortTermPct: 24, longTermPct: 15 };

export interface SaleTaxPreview {
  method: CostBasisMethod;
  shortTermGainUsd: DecimalString;
  longTermGainUsd: DecimalString;
  totalGainUsd: DecimalString;
  /** Estimated tax; losses are represented as a negative offset. */
  estTaxUsd: DecimalString;
  netProceedsUsd: DecimalString;
  shortfall: AssetQuantity;
}

export interface SaleTaxComparison {
  previews: SaleTaxPreview[];
  cheapest: CostBasisMethod;
  savingsVsCurrentUsd: UsdAmount;
  currentMethod: CostBasisMethod;
  harvestsLoss: boolean;
  note: string;
}

export const COST_BASIS_METHODS: readonly CostBasisMethod[] = [
  'fifo',
  'lifo',
  'hifo',
  'average',
];

/** Dry-run one cost-basis method without mutating the lot ledger. */
export function previewSaleTax(
  openLots: readonly TaxLot[],
  instrument: InstrumentIdentity,
  quantity: AssetQuantity,
  proceedsUsd: UsdAmount,
  method: CostBasisMethod,
  rates: TaxRateAssumption,
  now: number,
): SaleTaxPreview {
  const result = disposeLots(openLots, instrument, quantity, proceedsUsd, method, now);
  let shortGain = new Decimal(0);
  let longGain = new Decimal(0);
  for (const disposal of result.disposals) {
    if (disposal.longTerm) longGain = longGain.add(disposal.realizedPnlUsd);
    else shortGain = shortGain.add(disposal.realizedPnlUsd);
  }
  const estimatedTax = shortGain
    .mul(Math.max(0, rates.shortTermPct))
    .div(100)
    .add(longGain.mul(Math.max(0, rates.longTermPct)).div(100));
  return {
    method,
    shortTermGainUsd: decimal(shortGain.toFixed()),
    longTermGainUsd: decimal(longGain.toFixed()),
    totalGainUsd: decimal(shortGain.add(longGain).toFixed()),
    estTaxUsd: decimal(estimatedTax.toFixed()),
    netProceedsUsd: decimal(new Decimal(proceedsUsd).sub(estimatedTax).toFixed()),
    shortfall: result.shortfall,
  };
}

function formatWholeUsd(value: Decimal): string {
  const negative = value.isNegative();
  const digits = value.abs().toDecimalPlaces(0).toFixed();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}$${grouped}`;
}

/** Compare every method and identify the lowest estimated tax for this sale. */
export function compareSaleTax(
  openLots: readonly TaxLot[],
  instrument: InstrumentIdentity,
  quantity: AssetQuantity,
  proceedsUsd: UsdAmount,
  currentMethod: CostBasisMethod,
  rates: TaxRateAssumption,
  now: number,
): SaleTaxComparison {
  const previews = COST_BASIS_METHODS.map((method) =>
    previewSaleTax(openLots, instrument, quantity, proceedsUsd, method, rates, now),
  );
  const cheapest = previews.reduce((left, right) =>
    new Decimal(right.estTaxUsd).lt(left.estTaxUsd) ? right : left,
  );
  const current = previews.find((preview) => preview.method === currentMethod) ?? cheapest;
  const savings = new Decimal(current.estTaxUsd).sub(cheapest.estTaxUsd);
  const harvestsLoss = new Decimal(current.totalGainUsd).lt(0);

  let note: string;
  if (harvestsLoss) {
    note = `This sale realizes a ${formatWholeUsd(new Decimal(current.totalGainUsd))} loss under ${currentMethod.toUpperCase()} - a tax-loss harvest that can offset other gains.`;
  } else if (savings.gt(new Decimal(proceedsUsd).abs().mul(0.005))) {
    note = `Switching this sale's method to ${cheapest.method.toUpperCase()} would save an estimated ${formatWholeUsd(savings)} in tax vs ${currentMethod.toUpperCase()}.`;
  } else {
    note = `${currentMethod.toUpperCase()} is already (near-)optimal for this sale - estimated tax ${formatWholeUsd(new Decimal(current.estTaxUsd))}.`;
  }

  return {
    previews,
    cheapest: cheapest.method,
    savingsVsCurrentUsd: decimal(savings.toFixed()),
    currentMethod,
    harvestsLoss,
    note,
  };
}
