import { studySourceMatches } from './study-instance.js';
import { Decimal } from 'decimal.js';
import { instrumentKey } from '../types/index.js';
import { breakoutFourHourBars, evaluateBreakoutSlot } from './breakout.js';
import { evaluateMarketSelectorSlot, type MarketSelectorStudy,
  type SelectorPrevious } from './market-selector.js';
import { evaluateRangeRotationSlot } from './range-rotation.js';
import { markRangePortfolio, planRangeRotationShadow, rangeAssets,
  type RangeHistoryRead } from './range-rotation-replay.js';
import { freezeUniverse, UNIVERSE_DAY, universeHash, UNIVERSE_COSTS } from './wider-universe.js';
import { prepareDynamicUniverseDataset, universeStrategyInput,
  type DynamicUniverseSlot } from './wider-universe-dataset.js';
import { planUniverseShadow, type UniversePortfolio } from './wider-universe-replay.js';

/** Four independent books, all valued on the same recorded six-slot tape. */
export function compareMarketSelectorStudy(study: MarketSelectorStudy,
  rawSlots: readonly DynamicUniverseSlot[], phase: 'development' | 'holdout', nowMs: number,
  sourceContentHash: string, history: RangeHistoryRead) {
  const { planHash, ...material } = study;
  if (universeHash(material) !== planHash) throw new Error('selector_study_integrity');
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
  const results: { candidate: string; multiplier: number; netReturn: number; maxDrawdown: number;
    turnoverUsd: string; switchingTurnoverUsd: string; switchingCostsUsd: string; switches: number;
    feesUsd: string; spreadUsd: string; slippageUsd: string; orders: number; blockedOrders: number;
    blockedExits: number; maximumAssetWeight: number; concentrationIndex: number;
    minimumCashExposure: number; assetOrders: Record<string, number>;
    assetNetPnlUsd: Record<string, string>; monthlyReturns: Record<string, number>;
    curve: { atMs: number; equity: string }[] }[] = [];
  try {
    for (const multiplier of [1, 2]) for (const candidate of study.candidates) {
      let portfolio: UniversePortfolio = { cash: study.openingCash, quantities: {} };
      let target: Readonly<Record<string, number>> = {}, previousRange: ReturnType<typeof evaluateRangeRotationSlot> | null = null;
      let dailyBaseline: Readonly<Record<string, number>> | null = null;
      let previousSelector: SelectorPrevious | null = null;
      let dayStartEquity = study.openingCash, dailyTurnover = '0';
      let peak = new Decimal(study.openingCash), drawdown = 0;
      let turnover = new Decimal(0), fees = new Decimal(0), spread = new Decimal(0), slippage = new Decimal(0);
      let switchingTurnover = new Decimal(0), switchingCosts = new Decimal(0), switches = 0;
      let orders = 0, blockedOrders = 0, blockedExits = 0, maximumAssetWeight = 0;
      let concentrationIndex = 0, minimumCashExposure = 1;
      const assetOrders: Record<string, number> = {}, cashflows: Record<string, Decimal> = {};
      const months = new Map<string, [Decimal, Decimal]>(), curve: { atMs: number; equity: string }[] = [];
      for (const slot of dataset.slots) {
        const context = universeStrategyInput(slot, study.anchor, study.policy);
        if (context.evaluations.some((e) => e.reasons.includes('catalog_asof') || e.reasons.includes('account_fresh') ||
            e.checks.some((c) => c.code === 'account_ready' && c.status === 'unknown'))) throw new Error('missing_historical_eligibility');
        const midnight = slot.slotMs % UNIVERSE_DAY === 0;
        if (midnight) { dailyTurnover = '0'; dailyBaseline = context.baselineTargets; }
        const assets = rangeAssets(slot, study.policy, history);
        if (assets.some((a) => a.hourlyBars.some((bar) =>
          bar.retrievedAtMs === undefined || bar.retrievedAtMs < bar.startTimeMs + 3_600_000 ||
          bar.retrievedAtMs > a.observedAtMs)))
          throw new Error('future_known_hourly_evidence');
        if (['BTC', 'ETH'].some((base) => {
          const id = `coinbase|spot|${base}-USD`;
          const asset = assets.find((item) => item.assetId === id);
          return !asset || breakoutFourHourBars(id, asset.hourlyBars, slot.slotMs) === null;
        })) throw new Error('missing_market_state_hourly_evidence');
        const heldAssetIds = Object.entries(portfolio.quantities).filter(([, qty]) => new Decimal(qty).gt(0))
          .map(([id]) => id);
        let step: ReturnType<typeof planUniverseShadow> | ReturnType<typeof planRangeRotationShadow> | null = null;
        let desiredExitIds: string[] = [];
        let switching = false;
        if (candidate === 'selector') {
          const decision = evaluateMarketSelectorSlot({ slotMs: slot.slotMs, assets, heldAssetIds,
            baselineTarget: dailyBaseline, previous: previousSelector });
          switching = previousSelector !== null && decision.selected !== previousSelector.selected;
          previousSelector = decision;
          target = decision.target;
          if (decision.selected !== 'range_rotation') desiredExitIds = heldAssetIds.filter((id) =>
            (target[id] ?? 0) === 0);
          if (new Date(slot.slotMs).getUTCHours() === 4) dayStartEquity = markRangePortfolio(slot, portfolio).equity;
          if (decision.virtualExecutionAllowed) {
            if (decision.selected === 'range_rotation' && !midnight) {
              const planned = planRangeRotationShadow(slot, { weights: target,
                desiredExits: decision.candidates.range_rotation.desiredExits }, portfolio,
                dayStartEquity, dailyTurnover, study.policy, multiplier);
              dailyTurnover = planned.dailyTurnoverUsd;
              blockedExits += planned.blockedExits.length;
              step = planned;
            } else step = planUniverseShadow(slot, target, portfolio, study.policy,
              multiplier, study.guardrails);
          }
        } else if (candidate === 'trendvol') {
          if (midnight) target = context.baselineTargets;
          desiredExitIds = heldAssetIds.filter((id) => (target[id] ?? 0) === 0);
          step = planUniverseShadow(slot, target, portfolio, study.policy,
            multiplier, study.guardrails);
        } else if (!midnight) {
          if (candidate === 'breakout') {
            target = evaluateBreakoutSlot({ slotMs: slot.slotMs, assets, heldAssetIds }).weights;
            desiredExitIds = heldAssetIds.filter((id) => (target[id] ?? 0) === 0);
            step = planUniverseShadow(slot, target, portfolio, study.policy,
              multiplier, study.guardrails);
          } else {
            if (new Date(slot.slotMs).getUTCHours() === 4) dayStartEquity = markRangePortfolio(slot, portfolio).equity;
            const decision = evaluateRangeRotationSlot({ slotMs: slot.slotMs, assets, heldAssetIds,
              previousSlotMs: previousRange?.slotMs ?? null,
              previousQualifiedIds: previousRange?.qualifiedIds ?? [],
              previousReplacementIds: previousRange?.replacementIds ?? [] });
            previousRange = decision; target = decision.weights;
            const planned = planRangeRotationShadow(slot, decision, portfolio, dayStartEquity,
              dailyTurnover, study.policy, multiplier);
            dailyTurnover = planned.dailyTurnoverUsd; blockedExits += planned.blockedExits.length;
            step = planned;
          }
        }
        if (step) {
          portfolio = step.portfolio;
          const cost = new Decimal(step.feesUsd).plus(step.spreadUsd).plus(step.slippageUsd);
          if (switching) { switches++; switchingTurnover = switchingTurnover.plus(step.turnoverUsd);
            switchingCosts = switchingCosts.plus(cost); }
          turnover = turnover.plus(step.turnoverUsd); fees = fees.plus(step.feesUsd);
          spread = spread.plus(step.spreadUsd); slippage = slippage.plus(step.slippageUsd);
          orders += step.orders.length; blockedOrders += step.rejected.length;
          blockedExits += desiredExitIds.filter((id) => !step.orders.some((order) =>
            order.assetId === id && order.side === 'sell')).length;
          for (const order of step.orders) {
            assetOrders[order.assetId] = (assetOrders[order.assetId] ?? 0) + 1;
            const notional = new Decimal(order.notional);
            const flow = order.side === 'buy' ? notional.negated() :
              notional.mul(new Decimal(1).minus(new Decimal(UNIVERSE_COSTS.takerFee).mul(multiplier)));
            cashflows[order.assetId] = (cashflows[order.assetId] ?? new Decimal(0)).plus(flow);
          }
        }
        const mark = markRangePortfolio(slot, portfolio), equity = new Decimal(mark.equity);
        peak = Decimal.max(peak, equity); drawdown = Math.min(drawdown, equity.div(peak).minus(1).toNumber());
        maximumAssetWeight = Math.max(maximumAssetWeight, mark.maximumAssetWeight);
        concentrationIndex = Math.max(concentrationIndex, mark.concentrationIndex);
        minimumCashExposure = Math.min(minimumCashExposure, mark.cashExposure);
        const month = new Date(slot.slotMs).toISOString().slice(0, 7);
        const prior = months.get(month); months.set(month, prior ? [prior[0], equity] : [equity, equity]);
        curve.push({ atMs: slot.slotMs, equity: mark.equity });
      }
      const last = dataset.slots.at(-1)!;
      const assetNetPnlUsd = Object.fromEntries([...new Set([...Object.keys(cashflows),
        ...Object.keys(portfolio.quantities)])].sort().map((id) => {
        const observation = last.observations.find((o) => instrumentKey(o.evidence.product.instrument) === id);
        if (!observation?.evidence.alpaca) throw new Error('missing_final_asset_mark');
        const q = observation.evidence.alpaca;
        return [id, (cashflows[id] ?? new Decimal(0)).plus(new Decimal(portfolio.quantities[id] ?? 0)
          .mul(new Decimal(q.bid).plus(q.ask).div(2))).toFixed()];
      }));
      results.push({ candidate, multiplier,
        netReturn: new Decimal(curve.at(-1)!.equity).div(study.openingCash).minus(1).toNumber(),
        maxDrawdown: drawdown, turnoverUsd: turnover.toFixed(), switchingTurnoverUsd: switchingTurnover.toFixed(),
        switchingCostsUsd: switchingCosts.toFixed(), switches, feesUsd: fees.toFixed(),
        spreadUsd: spread.toFixed(), slippageUsd: slippage.toFixed(), orders, blockedOrders,
        blockedExits, maximumAssetWeight, concentrationIndex, minimumCashExposure,
        assetOrders, assetNetPnlUsd, monthlyReturns: Object.fromEntries([...months]
          .map(([month, [first, end]]) => [month, end.div(first).minus(1).toNumber()])), curve });
    }
  } catch { return { status: 'invalid_evidence' as const, phase, planHash,
    datasetHash: dataset.datasetHash, results: null }; }
  return freezeUniverse({ status: 'modeled_only' as const, phase, planHash,
    datasetHash: dataset.datasetHash, universeHash: dataset.universeHash,
    results: results.map((result) => ({ ...result,
      netReturnDifference: result.netReturn - results.find((r) => r.candidate === 'trendvol' &&
        r.multiplier === result.multiplier)!.netReturn })),
    immediateFillAssumption: true as const, promotion: 'disabled' as const });
}
