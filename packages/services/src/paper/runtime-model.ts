import {
  canonicalJson,
  decimal,
  instrumentKey,
  sha256Hex,
  type AllocationPolicy,
  type CanonicalJsonValue,
  type Clock,
  type DecisionMarketDataset,
  type Holding,
  type InstrumentKey,
  type ExecutionIntent,
  type PaperPortfolioSnapshotV1,
} from '@coqui/core';
import { Decimal } from 'decimal.js';
import {
  appendWalletRunAudit,
  listPaperBalances,
  type Db,
} from '@coqui/storage';

import type { PaperMarketData } from './oms.js';

export const PAPER_ALLOCATION_REBALANCER_VERSION = 'allocation-policy-rebalancer-v1';
export const PAPER_TRENDVOL_VERSION = 'trendvol-paper-v1-unvalidated';

export type PaperRunStandDown =
  | 'kill_switch_engaged'
  | 'no_policy'
  | 'no_intents'
  | 'gates_refused'
  | 'pending_review'
  | 'execution_failed'
  | 'execution_unknown'
  | 'market_fetch_failed'
  | 'invalid_market_data'
  | 'market_alignment_failed'
  | 'insufficient_history'
  | 'stale_market_data'
  | 'stale_product_rules'
  | 'paper_book_empty'
  | 'paper_book_incomplete'
  | 'paper_book_requires_reset'
  | 'pending_settlement';

export type PaperDecisionPreparation =
  | {
      readonly ok: true;
      readonly datasetHash: string;
      readonly dataset: DecisionMarketDataset;
      readonly latestCompletedStartMs: number;
      readonly expectedCompletedStartMs: number;
      readonly ruleSnapshotHash: string;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'market_fetch_failed'
        | 'invalid_market_data'
        | 'market_alignment_failed'
        | 'insufficient_history'
        | 'stale_market_data'
        | 'stale_product_rules';
      readonly datasetHash?: string;
      readonly latestCompletedStartMs?: number;
      readonly expectedCompletedStartMs?: number;
      readonly ruleSnapshotHash?: string;
      readonly rulesFresh?: boolean;
    };

export interface PaperRunSummary {
  readonly profileId: string;
  readonly runId: string;
  readonly strategyVersion: string;
  readonly scheduledForMs: number;
  readonly decidedAtMs: number;
  readonly standDown: PaperRunStandDown | null;
  readonly filledCount: number;
  readonly submittedCount: number;
  readonly refusedCount: number;
  readonly preDecisionBalances: readonly { readonly assetId: string; readonly quantity: string }[];
}

export interface PaperRunLoopDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly profileId: string;
  readonly market: PaperMarketData;
  readonly holdings: () => readonly Holding[];
  readonly policy: () => AllocationPolicy | null;
  readonly preparation: () => PaperDecisionPreparation;
  readonly historicalGrossEdgeLowerBoundPct: number | null;
  readonly evidenceVerified?: () => boolean;
  readonly executionOwnerId?: string;
  readonly captureEvidence?: (summary: PaperRunSummary) => Promise<void>;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
}

export function runIdFor(profileId: string, scheduledForMs: number): string {
  return sha256Hex(`paper:${profileId}:${scheduledForMs}`);
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value as CanonicalJsonValue));
}

function instrumentFromKey(assetId: string): AllocationPolicy['targets'][number]['instrument'] {
  const [venue, productType, productId, extra] = assetId.split('|');
  if (venue !== 'coinbase' || productType !== 'spot' || !productId || extra !== undefined) {
    throw new Error(`Invalid paper instrument ${assetId}.`);
  }
  return { venue, productType, productId };
}

export function openingSnapshot(
  profileId: string,
  holdings: readonly Holding[],
  at: number,
): PaperPortfolioSnapshotV1 | PaperRunStandDown {
  if (holdings.length === 0) return 'paper_book_empty';
  if (holdings.some((holding) => holding.priceUsd === null || holding.valueUsd === null ||
      !Number.isFinite(Number(holding.priceUsd)) || Number(holding.priceUsd) <= 0)) {
    return 'paper_book_incomplete';
  }
  return {
    schemaVersion: 1,
    profileId,
    source: 'tracked_holdings_opening',
    balances: holdings.map((holding) => ({
      assetId: instrumentKey(holding.asset.instrument),
      quantity: holding.quantity,
      priceUsd: holding.priceUsd!,
      valueUsd: holding.valueUsd!,
    })).sort((left, right) => left.assetId < right.assetId ? -1 : 1),
    cashUsd: '0',
    asOfMs: at,
  };
}

export function paperHoldings(
  profileId: string,
  policy: AllocationPolicy,
  preparation: Extract<PaperDecisionPreparation, { ok: true }>,
  database: Db,
): readonly Holding[] {
  const instruments = new Map(policy.targets.map((target) =>
    [instrumentKey(target.instrument), target.instrument]));
  const balances = new Map(listPaperBalances(profileId, database)
    .filter((balance) => balance.assetId !== 'USD')
    .map((balance) => [balance.assetId as InstrumentKey, balance.quantity]));
  for (const target of policy.targets) {
    const key = instrumentKey(target.instrument);
    if (!balances.has(key)) balances.set(key, '0');
  }
  return [...balances].sort(([left], [right]) => left < right ? -1 : 1).map(([assetId, quantity]) => {
    const instrument = instruments.get(assetId) ?? instrumentFromKey(assetId);
    const price = preparation.dataset.closesById[assetId]?.at(-1);
    if (!Number.isFinite(price) || price! <= 0) throw new Error('paper_book_incomplete');
    const priceUsd = decimal(String(price));
    const valueUsd = decimal(new Decimal(quantity).mul(price!).toFixed());
    const symbol = instrument.productId.replace(/-USD$/u, '');
    return {
      asset: {
        instrument, symbol, name: symbol, baseAsset: symbol, quoteAsset: 'USD', coingeckoId: null,
      },
      quantity: decimal(quantity), avgCostUsd: priceUsd, priceUsd, valueUsd,
      unrealizedPnlUsd: decimal('0'), unrealizedPnlPct: 0,
    };
  });
}

export function normalizedMix(policy: AllocationPolicy, dataset: DecisionMarketDataset): number[] {
  const positive = policy.targets.filter((target) => target.weight > 0);
  const total = positive.reduce((sum, target) => sum + target.weight, 0);
  if (total <= 0) throw new Error('Allocation policy has no positive base weight.');
  return dataset.dayKeys.map((_, index) => positive.reduce((sum, target) => {
    const series = dataset.closesById[instrumentKey(target.instrument)];
    if (series === undefined || series[0] === undefined || series[index] === undefined) {
      throw new Error('paper_book_incomplete');
    }
    return sum + (target.weight / total) * (series[index] / series[0]);
  }, 0));
}

/** Plan against a cash-inclusive campaign sleeve without representing cash as a fake instrument. */
export function planExploratoryRebalance(
  holdings: readonly Holding[],
  cashUsd: string,
  policy: AllocationPolicy,
): readonly ExecutionIntent[] {
  const byId = new Map(holdings.map((holding) => [instrumentKey(holding.asset.instrument), holding]));
  const sleeveValue = holdings.reduce((sum, holding) => sum.add(holding.valueUsd ?? '0'),
    new Decimal(cashUsd));
  if (!sleeveValue.isPositive()) return [];
  const intents: ExecutionIntent[] = [];
  for (const target of policy.targets) {
    const holding = byId.get(instrumentKey(target.instrument));
    if (holding === undefined || holding.priceUsd === null || holding.valueUsd === null) continue;
    const actual = new Decimal(holding.valueUsd);
    const actualWeight = actual.div(sleeveValue).toNumber();
    const driftPct = (actualWeight - target.weight) * 100;
    if (Math.abs(driftPct) < policy.rebalanceBandPct) continue;
    const delta = sleeveValue.mul(target.weight).minus(actual);
    if (delta.isZero()) continue;
    intents.push({
      asset: holding.asset,
      side: delta.isPositive() ? 'buy' : 'sell',
      amountUsd: decimal(delta.abs().toFixed()),
      origin: 'rebalance',
      reason: `${delta.isPositive() ? 'underweight' : 'overweight'} ${driftPct >= 0 ? '+' : ''}${driftPct.toFixed(1)}pp vs ${(target.weight * 100).toFixed(0)}% target`,
      urgency: 'passive',
      referencePriceUsd: holding.priceUsd,
    });
  }
  return Object.freeze(intents.sort((left, right) => left.side !== right.side
    ? left.side === 'sell' ? -1 : 1
    : instrumentKey(left.asset.instrument).localeCompare(instrumentKey(right.asset.instrument))));
}

export function journal(
  database: Db,
  profileId: string,
  runId: string,
  at: number,
  kind: string,
  status: string,
  detail: Record<string, unknown>,
): void {
  appendWalletRunAudit({
    id: sha256Hex(`${runId}:${kind}:${at}`),
    profileId,
    runId,
    at,
    kind,
    status,
    detailJson: JSON.stringify({ paperOnly: true, ...detail }),
  }, database);
}
