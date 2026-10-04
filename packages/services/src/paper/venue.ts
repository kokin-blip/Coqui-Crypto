import {
  canonicalJson,
  estimateTradeCost,
  normalizePaperOrder,
  modeledFill,
  sha256Hex,
  DEFAULT_TRADE_COST_CONFIG,
  type CanonicalJsonValue,
  type InstrumentIdentity,
  type MarketBar,
  type ProductRuleSnapshot,
  type TradeCostConfig,
} from '@coqui/core';
import { Decimal } from 'decimal.js';

/**
 * The simulated venue.
 *
 * It must agree with `packages/core/src/backtest/engine.ts` exactly, because
 * B4's reconciliation harness compares paper fills against what the backtest
 * assumed — a venue that fills differently would make the harness measure its
 * own inconsistency instead of a real divergence.
 *
 * The corrected research engine uses provider publication availability and the
 * first attainable open. Paper pending orders bind their expected execution bar.
 * Legacy immediate orders retain their boundary-compatible timing; synthetic
 * close-only fills remain explicitly exploratory.
 */

export type PaperExecutionModel = 'next_open' | 'next_close_conservative';

export type VenueRefusalCode =
  | 'no_execution_bar'
  | 'execution_bar_incomplete'
  | 'rules_reject'
  | 'non_positive_price';

export interface VenueRefusal {
  readonly filled: false;
  readonly code: VenueRefusalCode;
  /** The venue's own words when it was the product rules that refused. */
  readonly reason: string | null;
}

export interface SimulatedFill {
  readonly filled: true;
  readonly instrument: InstrumentIdentity;
  readonly side: 'buy' | 'sell';
  readonly quantity: string;
  readonly referencePrice: string;
  readonly executionPrice: string;
  readonly notional: string;
  readonly venueFee: string;
  readonly spreadCost: string;
  readonly slippageCost: string;
  readonly impactCost: string;
  readonly filledAtMs: number;
  readonly executionModel: PaperExecutionModel;
  /** The bar the fill was priced from, for the reconciliation harness. */
  readonly executionBarStartMs: number;
}

export type VenueOutcome = SimulatedFill | VenueRefusal;

export function paperCostModelHash(
  config: TradeCostConfig = DEFAULT_TRADE_COST_CONFIG,
): string {
  return sha256Hex(canonicalJson(config as unknown as CanonicalJsonValue));
}

export function isFilled(outcome: VenueOutcome): outcome is SimulatedFill {
  return outcome.filled;
}

function refuse(code: VenueRefusalCode, reason: string | null = null): VenueRefusal {
  return { filled: false, code, reason };
}

/**
 * The first bar that opens at or after the decision.
 *
 * Strictly after the observed window: a bar the signal could already see is
 * never eligible. Bars are expected ascending, and the scan does not assume it
 * beyond taking the earliest match.
 */
export function selectExecutionBar(
  bars: readonly MarketBar[],
  decidedAtMs: number,
): MarketBar | null {
  let chosen: MarketBar | null = null;
  for (const bar of bars) {
    if (bar.startTimeMs < decidedAtMs) continue;
    if (chosen === null || bar.startTimeMs < chosen.startTimeMs) chosen = bar;
  }
  return chosen;
}

/**
 * Which model applies to this bar set.
 *
 * Matches the legacy compatibility model: opens are used only when *every* bar is
 * provider-reported. One synthetic or close-only bar downgrades the whole set,
 * because a mixed series would price some fills at an open and others at a
 * close without saying so.
 */
export function executionModelFor(bars: readonly MarketBar[]): PaperExecutionModel {
  return bars.every((bar) => (bar.quality ?? 'reported_ohlc') === 'reported_ohlc')
    ? 'next_open'
    : 'next_close_conservative';
}

export interface SimulateFillInput {
  readonly instrument: InstrumentIdentity;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly requestedUsd: string;
  readonly availableCashUsd: string;
  readonly rules: ProductRuleSnapshot;
  /** Every bar known for this instrument; the venue picks the execution bar. */
  readonly bars: readonly MarketBar[];
  readonly decidedAtMs: number;
  /**
   * Optional only so a cost-specific test can vary it. Invariant 14: every
   * backtest, sweep, paper fill and preview reads the same venue profile.
   */
  readonly costConfig?: TradeCostConfig;
}

/**
 * Price one order against the next bar.
 *
 * Costs come from `estimateTradeCost`, the only function that decomposes into
 * fee / spread / slippage / impact. The three execution components are folded
 * into the price by `paperExecutionPrice`; the fee is *not*, because a fee is
 * charged on top of the trade rather than moving the price you traded at, and
 * `paperFillLedgerEntries` posts it as its own ledger leg.
 */
export function simulateFill(input: SimulateFillInput): VenueOutcome {
  const bar = selectExecutionBar(input.bars, input.decidedAtMs);
  if (bar === null) return refuse('no_execution_bar');

  // Invariant 6 again, from the other side: an unclosed bar is not a fact yet.
  if (!bar.isComplete) return refuse('execution_bar_incomplete');

  const executionModel = executionModelFor(input.bars);
  const reference = executionModel === 'next_open' ? bar.open : bar.close;
  if (!Number.isFinite(reference) || reference <= 0) return refuse('non_positive_price');
  const referencePrice = String(reference);

  const costConfig = input.costConfig ?? DEFAULT_TRADE_COST_CONFIG;
  const available = new Decimal(input.availableCashUsd);
  const normalizationCapacity = input.side === 'buy' && available.isPositive()
    ? available.div(new Decimal(1).add(new Decimal(estimateTradeCost(
      {
        asset: { instrument: input.instrument, symbol: input.symbol },
        side: input.side,
        amountUsd: available.toNumber(),
      },
      costConfig,
    ).totalCostPct).div(100))).toFixed()
    : input.availableCashUsd;

  const normalized = normalizePaperOrder(
    input.requestedUsd,
    referencePrice,
    input.rules,
    normalizationCapacity,
  );
  if (!normalized.accepted) return refuse('rules_reject', normalized.reason);

  let fill;
  try {
    fill = modeledFill(input.side, normalized.quantity, referencePrice, costConfig);
  } catch { return refuse('non_positive_price'); }

  return {
    filled: true,
    instrument: input.instrument,
    side: input.side,
    quantity: normalized.quantity,
    referencePrice,
    executionPrice: fill.executionPrice,
    notional: fill.notional,
    venueFee: fill.venueFee,
    spreadCost: fill.spreadCost,
    slippageCost: fill.slippageCost,
    impactCost: fill.impactCost,
    // The fill happens when the execution bar opens, not when the decision was
    // taken. Stamping the decision time would misreport fill latency to the
    // reconciliation harness.
    filledAtMs: bar.startTimeMs,
    executionModel,
    executionBarStartMs: bar.startTimeMs,
  };
}
