import { studySourceMatches } from './study-instance.js';
import { Decimal } from 'decimal.js';
import { instrumentKey } from '../types/index.js';
import { breakoutFourHourBars, evaluateBreakoutSlot,
  type BreakoutAssetInput, type BreakoutHourlyBar } from './breakout.js';
import { evaluateUniverseAsset, freezeUniverse, UNIVERSE_COSTS, UNIVERSE_DAY,
  universeHash, type UniversePolicy } from './wider-universe.js';
import { prepareDynamicUniverseDataset, universeStrategyInput,
  type DynamicUniverseSlot } from './wider-universe-dataset.js';
import { planUniverseShadow, type UniversePortfolio } from './wider-universe-replay.js';
import { evaluateRangeRotationSlot, RANGE_ROTATION_RULES,
  type RangeRotationStudy } from './range-rotation.js';

export interface RangeHistoryRead {
  (assetId: string, fromMs: number, toMs: number, observedAtMs: number): readonly BreakoutHourlyBar[];
}
type RangeDecision = ReturnType<typeof evaluateRangeRotationSlot>;

export function rangeAssets(slot: DynamicUniverseSlot, policy: UniversePolicy,
  history: RangeHistoryRead): BreakoutAssetInput[] {
  return slot.observations.filter((o) => o.evidence.mapping !== null).map((o) => {
    const assetId = instrumentKey(o.evidence.product.instrument), quote = o.evidence.alpaca;
    return { assetId, eligibility: evaluateUniverseAsset(o.evidence, o.atMs, policy),
      hourlyBars: history(assetId, slot.slotMs - 720 * 3_600_000, slot.slotMs, o.atMs),
      quote: quote === null ? null : { bid: quote.bid, ask: quote.ask, atMs: quote.quoteAtMs },
      observedAtMs: o.atMs };
  });
}
export function markRangePortfolio(slot: DynamicUniverseSlot, portfolio: UniversePortfolio) {
  let equity = new Decimal(portfolio.cash);
  const weights: Decimal[] = [];
  for (const [assetId, quantity] of Object.entries(portfolio.quantities)) {
    const qty = new Decimal(quantity);
    if (qty.isZero()) continue;
    const observation = slot.observations.find((o) => instrumentKey(o.evidence.product.instrument) === assetId);
    const quote = observation?.evidence.alpaca;
    if (!observation || !quote || quote.quoteAtMs > observation.atMs ||
        observation.atMs - quote.quoteAtMs > 60_000) throw new Error('missing_valuation_evidence');
    const mid = new Decimal(quote.bid).plus(quote.ask).div(2);
    if (!mid.isFinite() || !mid.gt(0)) throw new Error('invalid_valuation_evidence');
    const value = qty.mul(mid); equity = equity.plus(value); weights.push(value);
  }
  if (!equity.gt(0)) throw new Error('invalid_virtual_equity');
  const relative = weights.map((value) => value.div(equity).toNumber());
  const invested = relative.reduce((sum, value) => sum + value, 0);
  return { equity: equity.toFixed(), cashExposure: new Decimal(portfolio.cash).div(equity).toNumber(),
    maximumAssetWeight: Math.max(0, ...relative),
    concentrationIndex: invested === 0 ? 0 : relative.reduce((sum, weight) => sum + (weight / invested) ** 2, 0) };
}

/** Applies the frozen slot/day limits to virtual execution only. */
export function planRangeRotationShadow(slot: DynamicUniverseSlot,
  decision: Pick<RangeDecision, 'weights' | 'desiredExits'>,
  portfolio: UniversePortfolio, dayStartEquity: string, priorDayTurnoverUsd: string,
  policy: UniversePolicy, multiplier = 1) {
  const before = markRangePortfolio(slot, portfolio);
  const remaining = Decimal.max(0, new Decimal(dayStartEquity)
    .mul(RANGE_ROTATION_RULES.maximumDailyTurnover).minus(priorDayTurnoverUsd));
  const slotLimit = Decimal.min(RANGE_ROTATION_RULES.maximumSlotTurnover,
    remaining.div(before.equity)).toNumber();
  const guardrails = { minTradeUsd: 25, maxTradeCostPct: 1.25,
    maxTurnoverPct: slotLimit, maxTrades: RANGE_ROTATION_RULES.maximumSlotOrders,
    // The planner checks priced order notional; allow cost headroom above 10% target weight.
    maxPositionPct: 0.105, maxTotalAtRiskPct: 0.315 };
  const step = planUniverseShadow(slot, decision.weights, portfolio, policy, multiplier, guardrails);
  const blockedExits = decision.desiredExits.filter((id) => !step.orders.some((o) => o.assetId === id && o.side === 'sell'));
  return freezeUniverse({ ...step, dayStartEquity, dailyTurnoverUsd: new Decimal(priorDayTurnoverUsd)
    .plus(step.turnoverUsd).toFixed(), blockedExits,
    blockedEntries: step.rejected.filter((r) => decision.weights[r.assetId] !== undefined),
    slotTurnoverLimit: slotLimit });
}

/** One registered calendar and evidence tape for all three candidate portfolios. */
export function compareRangeRotationStudy(study: RangeRotationStudy,
  rawSlots: readonly DynamicUniverseSlot[], phase: 'development' | 'holdout', nowMs: number,
  sourceContentHash: string, history: RangeHistoryRead) {
  const { planHash, ...material } = study;
  if (universeHash(material) !== planHash) throw new Error('range_study_integrity');
  if (!studySourceMatches(study.sourceContentHash, sourceContentHash)) return { status: 'source_changed' as const,
    phase, planHash, results: null };
  const startMs = phase === 'development' ? study.startMs : study.holdoutStartMs;
  const endMs = phase === 'development' ? study.holdoutStartMs : study.endExclusiveMs;
  if (nowMs < endMs) return { status: 'collecting' as const, phase, planHash, results: null };
  let dataset;
  try { dataset = prepareDynamicUniverseDataset(rawSlots.filter((s) => s.slotMs >= startMs && s.slotMs < endMs),
    startMs, endMs); }
  catch { return { status: 'invalid_evidence' as const, phase, planHash, results: null }; }
  if (dataset.missingSlots.length) return { status: 'incomplete' as const, phase, planHash,
    datasetHash: dataset.datasetHash, missingSlots: dataset.missingSlots, results: null };
  type Result = { candidate: 'trendvol' | 'breakout' | 'range_rotation'; multiplier: number;
    netReturn: number; maxDrawdown: number; turnoverUsd: string; orders: number;
    feesUsd: string; spreadUsd: string; slippageUsd: string; maximumAssetWeight: number;
    concentrationIndex: number; minimumCashExposure: number; blockedOrders: number;
    blockedExits: number; assetOrders: Record<string, number>; assetNetPnlUsd: Record<string, string>;
    monthlyReturns: Record<string, number>; curve: { atMs: number; equity: string }[] };
  const results: Result[] = [];
  try {
    for (const multiplier of [1, 2]) for (const candidate of study.candidates) {
      let portfolio: UniversePortfolio = { cash: study.openingCash, quantities: {} };
      let target: Readonly<Record<string, number>> = {}, previousRange: RangeDecision | null = null;
      let dayStartEquity = study.openingCash, dailyTurnover = '0';
      let peak = new Decimal(study.openingCash), drawdown = 0, turnover = new Decimal(0);
      let fees = new Decimal(0), spread = new Decimal(0), slippage = new Decimal(0);
      let orders = 0, blockedOrders = 0, blockedExits = 0, maximumAssetWeight = 0;
      let concentrationIndex = 0, minimumCashExposure = 1;
      const assetOrders: Record<string, number> = {}, cashflows: Record<string, Decimal> = {};
      const months = new Map<string, [Decimal, Decimal]>(), curve: { atMs: number; equity: string }[] = [];
      for (const slot of dataset.slots) {
        const context = universeStrategyInput(slot, study.anchor, study.policy);
        if (context.evaluations.some((e) => e.reasons.includes('catalog_asof') || e.reasons.includes('account_fresh') ||
            e.checks.some((c) => c.code === 'account_ready' && c.status === 'unknown'))) throw new Error('missing_historical_eligibility');
        if (slot.slotMs % UNIVERSE_DAY === 0) {
          dailyTurnover = '0';
          if (candidate === 'trendvol') target = context.baselineTargets;
        }
        let step: ReturnType<typeof planUniverseShadow> | null = null;
        if (candidate === 'range_rotation' && slot.slotMs % UNIVERSE_DAY !== 0) {
          if (new Date(slot.slotMs).getUTCHours() === 4) dayStartEquity = markRangePortfolio(slot, portfolio).equity;
          const assets = rangeAssets(slot, study.policy, history);
          if (assets.some((a) => a.eligibility.eligible &&
              (a.hourlyBars.some((bar) => bar.retrievedAtMs !== undefined && bar.retrievedAtMs > a.observedAtMs) ||
                breakoutFourHourBars(a.assetId, a.hourlyBars, slot.slotMs) === null))) throw new Error('missing_hourly_evidence');
          const heldAssetIds = Object.entries(portfolio.quantities).filter(([, qty]) => new Decimal(qty).gt(0))
            .map(([id]) => id);
          const decision = evaluateRangeRotationSlot({ slotMs: slot.slotMs, assets, heldAssetIds,
            previousSlotMs: previousRange?.slotMs ?? null,
            previousQualifiedIds: previousRange?.qualifiedIds ?? [],
            previousReplacementIds: previousRange?.replacementIds ?? [] });
          previousRange = decision;
          const planned = planRangeRotationShadow(slot, decision, portfolio, dayStartEquity,
            dailyTurnover, study.policy, multiplier);
          dailyTurnover = planned.dailyTurnoverUsd;
          blockedExits += planned.blockedExits.length;
          step = planned;
        } else if (candidate === 'breakout' && slot.slotMs % UNIVERSE_DAY !== 0) {
          const assets = rangeAssets(slot, study.policy, history);
          if (assets.some((a) => a.eligibility.eligible &&
              (a.hourlyBars.some((bar) => bar.retrievedAtMs !== undefined && bar.retrievedAtMs > a.observedAtMs) ||
                breakoutFourHourBars(a.assetId, a.hourlyBars, slot.slotMs) === null))) throw new Error('missing_hourly_evidence');
          const heldAssetIds = Object.entries(portfolio.quantities).filter(([, qty]) => new Decimal(qty).gt(0))
            .map(([id]) => id);
          target = evaluateBreakoutSlot({ slotMs: slot.slotMs, assets, heldAssetIds }).weights;
          step = planUniverseShadow(slot, target, portfolio, study.policy, multiplier, study.guardrails);
        } else if (candidate === 'trendvol') {
          step = planUniverseShadow(slot, target, portfolio, study.policy, multiplier, study.guardrails);
        }
        if (step) {
          portfolio = step.portfolio;
          turnover = turnover.plus(step.turnoverUsd); fees = fees.plus(step.feesUsd);
          spread = spread.plus(step.spreadUsd); slippage = slippage.plus(step.slippageUsd);
          orders += step.orders.length; blockedOrders += step.rejected.length;
          for (const order of step.orders) {
            assetOrders[order.assetId] = (assetOrders[order.assetId] ?? 0) + 1;
            const notional = new Decimal(order.notional);
            const cashflow = order.side === 'buy' ? notional.negated() :
              notional.mul(new Decimal(1).minus(new Decimal(UNIVERSE_COSTS.takerFee).mul(multiplier)));
            cashflows[order.assetId] = (cashflows[order.assetId] ?? new Decimal(0)).plus(cashflow);
          }
        }
        const mark = markRangePortfolio(slot, portfolio), equity = new Decimal(mark.equity);
        peak = Decimal.max(peak, equity); drawdown = Math.min(drawdown, equity.div(peak).minus(1).toNumber());
        maximumAssetWeight = Math.max(maximumAssetWeight, mark.maximumAssetWeight);
        concentrationIndex = Math.max(concentrationIndex, mark.concentrationIndex);
        minimumCashExposure = Math.min(minimumCashExposure, mark.cashExposure);
        const month = new Date(slot.slotMs).toISOString().slice(0, 7);
        const previous = months.get(month); months.set(month, previous ? [previous[0], equity] : [equity, equity]);
        curve.push({ atMs: slot.slotMs, equity: mark.equity });
      }
      const last = dataset.slots.at(-1)!;
      const assetNetPnlUsd = Object.fromEntries([...new Set([...Object.keys(cashflows),
        ...Object.keys(portfolio.quantities)])].sort().map((id) => {
        const observation = last.observations.find((o) => instrumentKey(o.evidence.product.instrument) === id);
        if (!observation?.evidence.alpaca) throw new Error('missing_final_asset_mark');
        const q = observation.evidence.alpaca;
        const mid = new Decimal(q.bid).plus(q.ask).div(2);
        return [id, (cashflows[id] ?? new Decimal(0)).plus(new Decimal(portfolio.quantities[id] ?? 0).mul(mid)).toFixed()];
      }));
      results.push({ candidate, multiplier, netReturn: new Decimal(curve.at(-1)!.equity)
        .div(study.openingCash).minus(1).toNumber(), maxDrawdown: drawdown,
      turnoverUsd: turnover.toFixed(), orders, feesUsd: fees.toFixed(), spreadUsd: spread.toFixed(),
      slippageUsd: slippage.toFixed(), maximumAssetWeight, concentrationIndex,
      minimumCashExposure, blockedOrders, blockedExits, assetOrders, assetNetPnlUsd,
      monthlyReturns: Object.fromEntries([...months].map(([month, [first, lastMark]]) =>
        [month, lastMark.div(first).minus(1).toNumber()])), curve });
    }
  } catch { return { status: 'invalid_evidence' as const, phase, planHash,
    datasetHash: dataset.datasetHash, results: null }; }
  return freezeUniverse({ status: 'modeled_only' as const, phase, planHash,
    datasetHash: dataset.datasetHash, universeHash: dataset.universeHash,
    results: results.map((result) => ({ ...result,
      netReturnDifference: result.netReturn - results.find((r) => r.candidate === 'trendvol' &&
        r.multiplier === result.multiplier)!.netReturn })), promotion: 'disabled' as const });
}
