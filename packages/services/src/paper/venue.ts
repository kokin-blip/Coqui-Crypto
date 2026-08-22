import {
  estimateTradeCost,
  normalizePaperOrder,
  paperExecutionPrice,
  DEFAULT_TRADE_COST_CONFIG,
  type InstrumentIdentity,
  type MarketBar,
  type ProductRuleSnapshot,
  type TradeCostConfig,
} from '@coqui/core';

/**
 * The simulated venue.
 *
 * It must agree with `packages/core/src/backtest/engine.ts` exactly, because
 * B4's reconciliation harness compares paper fills against what the backtest
 * assumed — a venue that fills differently would make the harness measure its
 * own inconsistency instead of a real divergence.
 *
 * The engine's mechanism is an **index offset, not a lookup**: signals read
 * `closes[0..i-1]` and execution reads `opens[i]`. Translated to a live daily
 * cadence, a decision taken from bars through yesterday's close fills at
 * today's open. That is invariant 6 — no same-bar fill, ever.
 *
 * The engine also degrades: `backtestDecisionDataset` uses opens only when every
 * bar is `reported_ohlc`, and otherwise falls back to closes under the label
 * `next_close_conservative`. This mirrors that, and records which model it used
 * so the harness can compare like with like.
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
 * Matches `backtestDecisionDataset`: opens are used only when *every* bar is
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

  const normalized = normalizePaperOrder(
    input.requestedUsd,
    referencePrice,
    input.rules,
    input.availableCashUsd,
  );
  if (!normalized.accepted) return refuse('rules_reject', normalized.reason);

  const costConfig = input.costConfig ?? DEFAULT_TRADE_COST_CONFIG;
  const costs = estimateTradeCost(
    {
      asset: { instrument: input.instrument, symbol: input.symbol },
      side: input.side,
      amountUsd: normalized.notionalUsd,
    },
    costConfig,
  );

  const spreadCost = costs.spreadUsd.toFixed(8);
  const slippageCost = costs.slippageUsd.toFixed(8);
  const impactCost = costs.impactUsd.toFixed(8);

  let executionPrice: string;
  try {
    executionPrice = paperExecutionPrice({
      side: input.side,
      referencePrice,
      quantity: normalized.quantity,
      spreadCost,
      slippageCost,
      impactCost,
    });
  } catch {
    // Costs large enough to drive the price non-positive mean the trade is not
    // executable at any size, which is a refusal rather than a clamped fill.
    return refuse('non_positive_price');
  }

  return {
    filled: true,
    instrument: input.instrument,
    side: input.side,
    quantity: normalized.quantity,
    referencePrice,
    executionPrice,
    notional: normalized.notionalUsd,
    venueFee: costs.feeUsd.toFixed(8),
    spreadCost,
    slippageCost,
    impactCost,
    // The fill happens when the execution bar opens, not when the decision was
    // taken. Stamping the decision time would misreport fill latency to the
    // reconciliation harness.
    filledAtMs: bar.startTimeMs,
    executionModel,
    executionBarStartMs: bar.startTimeMs,
  };
}
