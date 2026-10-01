import { studySourceMatches } from './study-instance.js';
import { Decimal } from 'decimal.js';
import { instrumentKey } from '../types/index.js';
import { evaluateBreakoutSlot, type BreakoutHourlyBar, type BreakoutStudy } from './breakout.js';
import { freezeUniverse, UNIVERSE_COSTS, UNIVERSE_DAY, universeHash } from './wider-universe.js';
import { prepareDynamicUniverseDataset, universeStrategyInput,
  type DynamicUniverseSlot } from './wider-universe-dataset.js';
import { planUniverseShadow, type UniversePortfolio } from './wider-universe-replay.js';

export interface BreakoutHistoryRead {
  (assetId: string, fromMs: number, toMs: number, observedAtMs: number): readonly BreakoutHourlyBar[];
}

/** Same six slot calendar, starting cash, and venue model for both candidates. */
export function compareBreakoutStudy(study: BreakoutStudy, rawSlots: readonly DynamicUniverseSlot[],
  phase: 'development' | 'holdout', nowMs: number, sourceContentHash: string,
  history: BreakoutHistoryRead) {
  const { planHash, ...material } = study;
  if (universeHash(material) !== planHash) throw new Error('breakout_study_integrity');
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
  type Result = { candidate: 'trendvol' | 'breakout'; multiplier: number; netReturn: number;
    maxDrawdown: number; turnoverUsd: string; orders: number; feesUsd: string; spreadUsd: string;
    slippageUsd: string; maximumAssetWeight: number; concentrationIndex: number;
    missedEntries: number; missedExits: number; assetOrders: Record<string, number>;
    assetNetPnlUsd: Record<string, string>;
    monthlyReturns: Record<string, number>; curve: { atMs: number; equity: string }[] };
  const results: Result[] = [];
  try {
    for (const multiplier of [1, 2]) for (const candidate of study.candidates) {
      let portfolio: UniversePortfolio = { cash: study.openingCash, quantities: {} };
      let peak = new Decimal(study.openingCash), maxDrawdown = 0;
      let turnover = new Decimal(0), fees = new Decimal(0), spread = new Decimal(0), slippage = new Decimal(0);
      let orders = 0, missedEntries = 0, missedExits = 0, maximumAssetWeight = 0, concentrationIndex = 0;
      let target: Readonly<Record<string, number>> = {};
      const assetOrders: Record<string, number> = {}, assetCashflows: Record<string, Decimal> = {};
      const monthlyValues = new Map<string, [Decimal, Decimal]>();
      const curve: { atMs: number; equity: string }[] = [];
      for (const slot of dataset.slots) {
        const context = universeStrategyInput(slot, study.anchor, study.policy);
        if (context.evaluations.some((e) => e.reasons.includes('catalog_asof') || e.reasons.includes('account_fresh') ||
            e.checks.some((c) => c.code === 'account_ready' && c.status === 'unknown'))) throw new Error('missing_historical_eligibility');
        if (candidate === 'trendvol' && slot.slotMs % UNIVERSE_DAY === 0) target = context.baselineTargets;
        if (candidate === 'breakout' && slot.slotMs % UNIVERSE_DAY !== 0) {
          const heldAssetIds = Object.entries(portfolio.quantities).filter(([, qty]) => new Decimal(qty).gt(0))
            .map(([id]) => id);
          const assets = slot.observations.filter((o) => o.evidence.mapping !== null).map((o) => {
            const assetId = instrumentKey(o.evidence.product.instrument), quote = o.evidence.alpaca;
            return { assetId, eligibility: context.evaluations.find((e) => e.assetId === assetId)!,
              hourlyBars: history(assetId, slot.slotMs - 720 * 3_600_000, slot.slotMs, o.atMs),
              quote: quote === null ? null : { bid: quote.bid, ask: quote.ask, atMs: quote.quoteAtMs },
              observedAtMs: o.atMs };
          });
          const decision = evaluateBreakoutSlot({ slotMs: slot.slotMs, assets, heldAssetIds });
          target = decision.weights;
          missedEntries += decision.assessments.filter((a) => a.reason === 'capacity_reached').length;
          const step = planUniverseShadow(slot, target, portfolio, study.policy, multiplier, study.guardrails);
          missedExits += decision.desiredExits.filter((id) => !step.orders.some((o) =>
            o.assetId === id && o.side === 'sell')).length;
          missedEntries += step.rejected.filter((r) => decision.assessments.some((a) =>
            a.assetId === r.assetId && a.reason === 'entry_selected')).length;
          portfolio = step.portfolio;
          ({ peak, maxDrawdown, turnover, fees, spread, slippage, orders, maximumAssetWeight,
            concentrationIndex } = collect(step, slot.slotMs, peak, maxDrawdown, turnover, fees,
            spread, slippage, orders, maximumAssetWeight, concentrationIndex, assetOrders,
            assetCashflows, multiplier, monthlyValues, curve));
          continue;
        }
        const step = planUniverseShadow(slot, target, portfolio, study.policy, multiplier, study.guardrails);
        portfolio = step.portfolio;
        ({ peak, maxDrawdown, turnover, fees, spread, slippage, orders, maximumAssetWeight,
          concentrationIndex } = collect(step, slot.slotMs, peak, maxDrawdown, turnover, fees,
          spread, slippage, orders, maximumAssetWeight, concentrationIndex, assetOrders,
          assetCashflows, multiplier, monthlyValues, curve));
      }
      const monthlyReturns = Object.fromEntries([...monthlyValues].map(([month, [first, last]]) =>
        [month, last.div(first).minus(1).toNumber()]));
      const last = dataset.slots.at(-1)!;
      const assetNetPnlUsd = Object.fromEntries([...new Set([...Object.keys(assetCashflows),
        ...Object.keys(portfolio.quantities)])].sort().map((id) => {
        const observation = last.observations.find((o) => instrumentKey(o.evidence.product.instrument) === id);
        const quote = observation?.evidence.alpaca;
        if (!quote) throw new Error('missing_final_asset_mark');
        const midpoint = new Decimal(quote.bid).plus(quote.ask).div(2);
        const mark = new Decimal(portfolio.quantities[id] ?? 0).mul(midpoint);
        return [id, (assetCashflows[id] ?? new Decimal(0)).plus(mark).toFixed()];
      }));
      results.push({ candidate, multiplier,
        netReturn: new Decimal(curve.at(-1)!.equity).div(study.openingCash).minus(1).toNumber(),
        maxDrawdown, turnoverUsd: turnover.toFixed(), orders, feesUsd: fees.toFixed(),
        spreadUsd: spread.toFixed(), slippageUsd: slippage.toFixed(), maximumAssetWeight,
        concentrationIndex, missedEntries, missedExits, assetOrders, assetNetPnlUsd,
        monthlyReturns, curve });
    }
  } catch { return { status: 'invalid_evidence' as const, phase, planHash,
    datasetHash: dataset.datasetHash, results: null }; }
  return freezeUniverse({ status: 'modeled_only' as const, phase, planHash, datasetHash: dataset.datasetHash,
    universeHash: dataset.universeHash, results: results.map((result) => ({ ...result,
      netReturnDifference: result.netReturn - results.find((r) => r.candidate === 'trendvol' &&
        r.multiplier === result.multiplier)!.netReturn })), promotion: 'disabled' as const });
}

function collect(step: ReturnType<typeof planUniverseShadow>, slotMs: number, peak: Decimal,
  maxDrawdown: number, turnover: Decimal, fees: Decimal, spread: Decimal, slippage: Decimal,
  orders: number, maximumAssetWeight: number, concentrationIndex: number,
  assetOrders: Record<string, number>, assetCashflows: Record<string, Decimal>, multiplier: number,
  monthlyValues: Map<string, [Decimal, Decimal]>,
  curve: { atMs: number; equity: string }[]) {
  const equity = new Decimal(step.equity), nextPeak = Decimal.max(peak, equity);
  const month = new Date(slotMs).toISOString().slice(0, 7);
  const values = monthlyValues.get(month);
  monthlyValues.set(month, values ? [values[0], equity] : [equity, equity]);
  for (const order of step.orders) {
    assetOrders[order.assetId] = (assetOrders[order.assetId] ?? 0) + 1;
    const notional = new Decimal(order.notional);
    const cashflow = order.side === 'buy' ? notional.negated() :
      notional.mul(new Decimal(1).minus(new Decimal(UNIVERSE_COSTS.takerFee).mul(multiplier)));
    assetCashflows[order.assetId] = (assetCashflows[order.assetId] ?? new Decimal(0)).plus(cashflow);
  }
  curve.push({ atMs: slotMs, equity: step.equity });
  return { peak: nextPeak, maxDrawdown: Math.min(maxDrawdown, equity.div(nextPeak).minus(1).toNumber()),
    turnover: turnover.plus(step.turnoverUsd), fees: fees.plus(step.feesUsd),
    spread: spread.plus(step.spreadUsd), slippage: slippage.plus(step.slippageUsd),
    orders: orders + step.orders.length, maximumAssetWeight: Math.max(maximumAssetWeight, step.maximumAssetWeight),
    concentrationIndex: Math.max(concentrationIndex, step.concentrationIndex) };
}
