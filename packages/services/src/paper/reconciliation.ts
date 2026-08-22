import {
  estimateTradeCost,
  instrumentKey,
  sha256Hex,
  DEFAULT_TRADE_COST_CONFIG,
  type Clock,
  type MarketBar,
  type PaperFill,
  type TradeCostConfig,
} from '@coqui/core';
import {
  appendRuntimeIncident,
  getPaperOrder,
  listPaperFills,
  type Db,
} from '@coqui/storage';

import { executionModelFor, type PaperExecutionModel } from './venue.js';
import type { PaperMarketData } from './oms.js';

/**
 * The reconciliation harness.
 *
 * `docs/PLAN.md` §6 names this one of the three things that matter most and
 * calls it "the only mechanism that can reveal a dishonest backtest before real
 * money does". `ARCHITECTURE.md` §6 says the same: it continuously compares
 * what the paper engine actually filled against what the backtest assumed.
 *
 * The comparison is only meaningful because the venue was built to match
 * `backtest/engine.ts` exactly. So a divergence here means one of three things,
 * all worth knowing: the venue drifted from the engine, the engine's
 * assumptions do not survive real data, or the bars underneath changed after
 * the fill. It reports rather than absorbs — an absorbed divergence is the
 * dishonesty this exists to catch.
 *
 * A fill whose bar cannot be found is **unverifiable**, never "aligned".
 * Counting missing evidence as agreement would let the harness report health it
 * has not established.
 */

/** Beyond this, a divergence is recorded as an incident rather than noise. */
const MATERIAL_DIVERGENCE_BPS = 5;
/** Beyond this it is a blocking-severity incident: the model is wrong, not noisy. */
const SEVERE_DIVERGENCE_BPS = 50;

export type FillReconciliationStatus = 'aligned' | 'diverged' | 'unverifiable';

export interface FillDivergence {
  readonly fillId: string;
  readonly orderId: string;
  readonly productId: string;
  readonly filledAtMs: number;
  readonly status: FillReconciliationStatus;
  /** What the backtest would have used for this bar, or null when unverifiable. */
  readonly expectedPriceUsd: string | null;
  readonly actualPriceUsd: string;
  readonly priceDivergenceBps: number | null;
  readonly expectedCostUsd: string | null;
  readonly actualCostUsd: string;
  readonly costDivergenceBps: number | null;
  /** Whole bars between the fill and the bar the backtest would have used. */
  readonly timingDivergenceBars: number | null;
  readonly executionModel: PaperExecutionModel | null;
}

export interface ReconciliationReport {
  readonly profileId: string;
  readonly asOfMs: number;
  readonly sinceMs: number;
  readonly fillCount: number;
  readonly alignedCount: number;
  readonly divergedCount: number;
  readonly unverifiableCount: number;
  /** Signed, so a systematic bias is visible rather than cancelled by absolutes. */
  readonly meanPriceDivergenceBps: number | null;
  readonly worstPriceDivergenceBps: number | null;
  readonly divergences: readonly FillDivergence[];
}

export interface PaperReconciliationDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly market: PaperMarketData;
  readonly costConfig?: TradeCostConfig;
}

function bpsBetween(expected: number, actual: number): number | null {
  if (!Number.isFinite(expected) || !Number.isFinite(actual) || expected === 0) return null;
  return ((actual - expected) / expected) * 10_000;
}

function barAt(bars: readonly MarketBar[], startTimeMs: number): MarketBar | null {
  return bars.find((bar) => bar.startTimeMs === startTimeMs) ?? null;
}

function barsBetween(bars: readonly MarketBar[], fromMs: number, toMs: number): number | null {
  const ordered = [...bars].sort((left, right) => left.startTimeMs - right.startTimeMs);
  const fromIndex = ordered.findIndex((bar) => bar.startTimeMs === fromMs);
  const toIndex = ordered.findIndex((bar) => bar.startTimeMs === toMs);
  return fromIndex < 0 || toIndex < 0 ? null : toIndex - fromIndex;
}

/**
 * Compare every recent paper fill against the backtest's assumption.
 *
 * Material divergences are appended to `runtime_incidents`, whose `kind` enum
 * already includes `reconciliation` and which is append-only by construction —
 * a resolution is a later incident, never an edit.
 */
export function reconcilePaperFills(
  dependencies: PaperReconciliationDependencies,
  profileId: string,
  sinceMs: number,
  limit = 1_000,
): ReconciliationReport {
  const asOfMs = dependencies.clock.nowMs();
  const costConfig = dependencies.costConfig ?? DEFAULT_TRADE_COST_CONFIG;
  const fills = listPaperFills(profileId, sinceMs, limit, dependencies.database);

  const divergences: FillDivergence[] = [];

  for (const fill of fills) {
    divergences.push(assess(fill, dependencies, costConfig, profileId, asOfMs));
  }

  const measured = divergences
    .map((divergence) => divergence.priceDivergenceBps)
    .filter((value): value is number => value !== null);

  return {
    profileId,
    asOfMs,
    sinceMs,
    fillCount: fills.length,
    alignedCount: divergences.filter((d) => d.status === 'aligned').length,
    divergedCount: divergences.filter((d) => d.status === 'diverged').length,
    unverifiableCount: divergences.filter((d) => d.status === 'unverifiable').length,
    meanPriceDivergenceBps:
      measured.length === 0
        ? null
        : measured.reduce((sum, value) => sum + value, 0) / measured.length,
    worstPriceDivergenceBps:
      measured.length === 0
        ? null
        : measured.reduce((worst, value) => (Math.abs(value) > Math.abs(worst) ? value : worst), 0),
    divergences: Object.freeze(divergences),
  };
}

function unverifiable(fill: PaperFill, productId: string): FillDivergence {
  return {
    fillId: fill.id,
    orderId: fill.orderId,
    productId,
    filledAtMs: fill.filledAt,
    status: 'unverifiable',
    expectedPriceUsd: null,
    actualPriceUsd: fill.executionPrice,
    priceDivergenceBps: null,
    expectedCostUsd: null,
    actualCostUsd: totalCostOf(fill),
    costDivergenceBps: null,
    timingDivergenceBars: null,
    executionModel: null,
  };
}

function totalCostOf(fill: PaperFill): string {
  return String(
    Number(fill.venueFee) + Number(fill.spreadCost) + Number(fill.slippageCost) +
      Number(fill.impactCost),
  );
}

function assess(
  fill: PaperFill,
  dependencies: PaperReconciliationDependencies,
  costConfig: TradeCostConfig,
  profileId: string,
  asOfMs: number,
): FillDivergence {
  const order = getPaperOrder(fill.orderId, dependencies.database);
  if (order === null) return unverifiable(fill, 'unknown');

  const productId = order.instrument.productId;
  const key = instrumentKey(order.instrument);
  const bars = dependencies.market.bars(key);
  const bar = barAt(bars, fill.filledAt);

  // The bar behind the fill is gone or was never retained. Reporting alignment
  // here would claim agreement with evidence that no longer exists.
  if (bar === null) return unverifiable(fill, productId);

  const executionModel = executionModelFor(bars);
  const reference = executionModel === 'next_open' ? bar.open : bar.close;

  // What the backtest assumes: the same reference price, moved by the same cost
  // model, through the same one-cost-model rule (invariant 14).
  const costs = estimateTradeCost(
    {
      asset: { instrument: order.instrument, symbol: productId },
      side: order.side,
      amountUsd: Number(fill.notional),
    },
    costConfig,
  );
  const quantity = Number(fill.quantity);
  const adjustmentPerUnit =
    quantity > 0 ? (costs.spreadUsd + costs.slippageUsd + costs.impactUsd) / quantity : 0;
  const expectedPrice =
    order.side === 'buy' ? reference + adjustmentPerUnit : reference - adjustmentPerUnit;

  const expectedCost =
    costs.feeUsd + costs.spreadUsd + costs.slippageUsd + costs.impactUsd;
  const actualCost = Number(totalCostOf(fill));

  const priceDivergenceBps = bpsBetween(expectedPrice, Number(fill.executionPrice));
  const costDivergenceBps = bpsBetween(expectedCost, actualCost);
  const timingDivergenceBars = barsBetween(bars, bar.startTimeMs, fill.filledAt);

  const material =
    priceDivergenceBps !== null && Math.abs(priceDivergenceBps) >= MATERIAL_DIVERGENCE_BPS;

  const divergence: FillDivergence = {
    fillId: fill.id,
    orderId: fill.orderId,
    productId,
    filledAtMs: fill.filledAt,
    status: material ? 'diverged' : 'aligned',
    expectedPriceUsd: String(expectedPrice),
    actualPriceUsd: fill.executionPrice,
    priceDivergenceBps,
    expectedCostUsd: String(expectedCost),
    actualCostUsd: String(actualCost),
    costDivergenceBps,
    timingDivergenceBars,
    executionModel,
  };

  if (material) recordIncident(dependencies.database, profileId, divergence, asOfMs);
  return divergence;
}

function recordIncident(
  database: Db,
  profileId: string,
  divergence: FillDivergence,
  asOfMs: number,
): void {
  const bps = divergence.priceDivergenceBps ?? 0;
  appendRuntimeIncident(
    {
      id: sha256Hex(`reconciliation:${divergence.fillId}`),
      profileId,
      runId: null,
      kind: 'reconciliation',
      // Beyond the severe threshold the model is wrong rather than noisy, and a
      // wrong model is what makes a backtest dishonest.
      severity: Math.abs(bps) >= SEVERE_DIVERGENCE_BPS ? 'blocking' : 'warning',
      source: 'paper_reconciliation',
      detailJson: JSON.stringify({
        fillId: divergence.fillId,
        productId: divergence.productId,
        priceDivergenceBps: bps,
        costDivergenceBps: divergence.costDivergenceBps,
        timingDivergenceBars: divergence.timingDivergenceBars,
        executionModel: divergence.executionModel,
      }),
      occurredAt: asOfMs,
      resolvedAt: null,
      resolution: null,
    },
    database,
  );
}
