import { Decimal } from 'decimal.js';
import { DEFAULT_AUTO_TRADE_GUARDRAILS, type AutoTradeGuardrails } from '../risk/autotrade.js';
import { instrumentKey } from '../types/index.js';
import { evaluateUniverseAsset, freezeUniverse, positive, UNIVERSE_COSTS, UNIVERSE_DAY, universeHash, universeQuantity,
  WIDER_UNIVERSE_POLICY, type UniversePolicy } from './wider-universe.js';
import { prepareDynamicUniverseDataset, universeStrategyInput,
  type DynamicUniverseDataset, type DynamicUniverseSlot, type WiderUniverseStudy } from './wider-universe-dataset.js';

export interface UniversePortfolio { readonly cash: string; readonly quantities: Readonly<Record<string, string>> }
export function planUniverseShadow(slot: DynamicUniverseSlot, targets: Readonly<Record<string, number>>,
  portfolio: UniversePortfolio, policy: UniversePolicy = WIDER_UNIVERSE_POLICY, multiplier = 1,
  guardrails: AutoTradeGuardrails = DEFAULT_AUTO_TRADE_GUARDRAILS) {
  if (![1, 2].includes(multiplier) || Object.values(targets).some((v) => !Number.isFinite(v) || v < 0) ||
      Object.values(targets).reduce((s, v) => s + v, 0) > 1.00000001) throw new Error('invalid_shadow_targets');
  let cash = new Decimal(portfolio.cash);
  const held = Object.fromEntries(Object.entries(portfolio.quantities).map(([id, q]) => [id, new Decimal(q)]));
  if (!cash.isFinite() || cash.isNegative() || Object.values(held).some((q) => !q.isFinite() || q.isNegative())) throw new Error('invalid_shadow_portfolio');
  const observations = new Map(slot.observations.map((o) => [instrumentKey(o.evidence.product.instrument) as string, o]));
  const mids: Record<string, Decimal> = {};
  for (const id of new Set([...Object.keys(targets), ...Object.keys(held).filter((id) => held[id]!.gt(0))])) {
    const observation = observations.get(id), q = observation?.evidence.alpaca;
    if (!q || !positive(q.bid) || !positive(q.ask) || new Decimal(q.ask).lt(q.bid) ||
        q.quoteAtMs > observation!.atMs || observation!.atMs - q.quoteAtMs > policy.freshnessMs) throw new Error('missing_valuation_evidence');
    mids[id] = new Decimal(q.bid).plus(q.ask).div(2);
  }
  const equity = cash.plus(Object.entries(held).reduce((sum, [id, q]) => sum.plus(q.mul(mids[id] ?? 0)), new Decimal(0)));
  if (!equity.gt(0)) throw new Error('invalid_shadow_equity');
  let turnover = new Decimal(0), fees = new Decimal(0), spreadCost = new Decimal(0), slippage = new Decimal(0);
  const orders: { assetId: string; side: 'buy' | 'sell'; quantity: string; modeledPrice: string; notional: string }[] = [];
  const rejected: { assetId: string; reasons: string[] }[] = [];
  const deltas = Object.keys(mids).map((id) => ({ id, delta: equity.mul(targets[id] ?? 0).div(mids[id]!).minus(held[id] ?? 0) }))
    .sort((a, b) => a.delta.cmp(b.delta) || a.id.localeCompare(b.id));
  for (const { id, delta } of deltas) {
    const o = observations.get(id)!; const a = o.evidence.asset; const quote = o.evidence.alpaca!;
    const buy = delta.isPositive(), side = buy ? 'buy' : 'sell';
    const reject = (reasons: string[]) => rejected.push({ assetId: id, reasons });
    const minTrade = Decimal.max(policy.minimumTradeUsd, guardrails.minTradeUsd);
    const band = slot.slotMs % UNIVERSE_DAY === 0 ? '0.05' : '0.01';
    if (delta.abs().mul(mids[id]!).lt(minTrade) || delta.abs().mul(mids[id]!).div(equity).lt(band)) {
      reject(['dust_or_drift']); continue;
    }
    if (!a || !positive(a.min_trade_increment) || !positive(a.min_order_size)) { reject(['quantity_rules_unknown']); continue; }
    const halfSpread = new Decimal(quote.ask).minus(quote.bid).div(2).mul(multiplier);
    const slip = mids[id]!.mul(UNIVERSE_COSTS.adverseSlippage).mul(multiplier);
    const price = mids[id]!.plus(halfSpread.plus(slip).mul(buy ? 1 : -1));
    if (!price.gt(0)) throw new Error('invalid_modeled_price');
    const available = buy ? cash.div(price) : held[id] ?? new Decimal(0);
    const qty = new Decimal(universeQuantity(Decimal.min(delta.abs(), available).toString(), a.min_trade_increment, a.min_order_size));
    const notional = qty.mul(price);
    if (qty.isZero() || notional.lt(minTrade)) { reject(['below_minimum_after_rounding']); continue; }
    const decision = evaluateUniverseAsset(o.evidence, o.atMs, policy, notional.toString());
    // History/selection failure does not prevent a supported exit. Alpaca rules and liquidity still do.
    const reasons = buy ? [...decision.reasons] : decision.reasons.filter((r) => r.startsWith('alpaca_') ||
      ['mapping', 'ambiguous_mapping', 'account_ready', 'account_fresh', 'catalog_asof', 'rules_unchanged', 'current_rules_fresh'].includes(r));
    if (guardrails.blockReason) reasons.push(guardrails.blockReason);
    if (orders.length >= guardrails.maxTrades) reasons.push('max_trades');
    if (turnover.plus(notional).div(equity).gt(guardrails.maxTurnoverPct)) reasons.push('turnover_cap');
    if (guardrails.maxTradeUsd !== undefined && notional.gt(guardrails.maxTradeUsd)) reasons.push('trade_cap');
    if (buy && (held[id] ?? new Decimal(0)).mul(mids[id]!).plus(notional).div(equity).gt(guardrails.maxPositionPct ?? 1)) reasons.push('position_cap');
    if (buy && equity.minus(cash).plus(notional).div(equity).gt(guardrails.maxTotalAtRiskPct ?? 1)) reasons.push('exposure_cap');
    const feeRate = new Decimal(UNIVERSE_COSTS.takerFee).mul(multiplier);
    if (feeRate.plus(halfSpread.plus(slip).div(mids[id]!)).mul(100).gt(guardrails.maxTradeCostPct)) reasons.push('cost_cap');
    if (reasons.length) { reject(reasons); continue; }
    const fee = notional.mul(feeRate);
    cash = buy ? cash.minus(notional) : cash.plus(notional.minus(fee));
    held[id] = (held[id] ?? new Decimal(0)).plus(buy ? qty.mul(new Decimal(1).minus(feeRate)) : qty.negated());
    fees = fees.plus(fee); spreadCost = spreadCost.plus(qty.mul(halfSpread)); slippage = slippage.plus(qty.mul(slip));
    turnover = turnover.plus(notional);
    orders.push({ assetId: id, side, quantity: qty.toFixed(), modeledPrice: price.toFixed(), notional: notional.toFixed() });
  }
  const marked = cash.plus(Object.entries(held).reduce((sum, [id, q]) => sum.plus(q.mul(mids[id] ?? 0)), new Decimal(0)));
  const weights = Object.entries(held).map(([id, q]) => q.mul(mids[id] ?? 0).div(marked).toNumber());
  const invested = weights.reduce((sum, w) => sum + w, 0);
  const hhi = weights.reduce((sum, w) => sum + (invested > 0 ? (w / invested) ** 2 : 0), 0);
  return freezeUniverse({ mode: 'shadow' as const, applied: false as const,
    portfolio: { cash: cash.toFixed(), quantities: Object.fromEntries(Object.entries(held).map(([id, q]) => [id, q.toFixed()])) },
    proposedTargets: targets, orders, rejected, equity: marked.toFixed(), turnoverUsd: turnover.toFixed(),
    feesUsd: fees.toFixed(), spreadUsd: spreadCost.toFixed(), slippageUsd: slippage.toFixed(),
    maximumAssetWeight: Math.max(0, ...weights), concentrationIndex: hhi,
    effectiveAssetCount: hhi > 0 ? 1 / hhi : 0, cashExposure: cash.div(marked).toNumber(),
    assumptionsHash: universeHash({ policy, costs: UNIVERSE_COSTS, multiplier, guardrails }) });
}

/** No holdout observations are passed to preparation or evaluation in development mode. */
export function compareWiderUniverse(study: WiderUniverseStudy, rawSlots: readonly DynamicUniverseSlot[],
  phase: 'development' | 'holdout', nowMs: number, evaluatorSourceHash: string = study.sourceContentHash) {
  const { planHash, ...material } = study;
  if (universeHash(material) !== planHash) throw new Error('study_integrity');
  if (evaluatorSourceHash !== study.sourceContentHash) return { status: 'source_changed' as const, phase, planHash, results: null };
  const start = phase === 'development' ? study.startMs : study.holdoutStartMs;
  const end = phase === 'development' ? study.holdoutStartMs : study.endExclusiveMs;
  if (nowMs < end) return { status: 'collecting' as const, phase, planHash, results: null };
  const scoped = rawSlots.filter((s) => s.slotMs >= start && s.slotMs < end);
  let dataset: DynamicUniverseDataset;
  try { dataset = prepareDynamicUniverseDataset(scoped, start, end); }
  catch { return { status: 'invalid_evidence' as const, phase, planHash, results: null }; }
  if (dataset.missingSlots.length) return { status: 'incomplete' as const, phase, planHash,
    datasetHash: dataset.datasetHash, missingSlots: dataset.missingSlots, results: null };
  const results: { candidate: 'baseline' | 'wider' | 'liquid'; multiplier: number; netReturn: number;
    maxDrawdown: number; turnoverUsd: string; turnoverMultiple: number; feesUsd: string; spreadUsd: string;
    slippageUsd: string; orders: number; assetSlots: number; eligibleAssetSlots: number; membershipChanges: number;
    exclusions: Record<string, number>; rejected: Record<string, number>;
    curve: { atMs: number; equity: string; maximumAssetWeight: number; concentrationIndex: number;
      effectiveAssetCount: number; cashExposure: number }[] }[] = [];
  try {
    for (const multiplier of [1, 2]) for (const candidate of study.candidates) {
      const policy = candidate === 'liquid' ? study.strictPolicy : study.policy;
      let portfolio: UniversePortfolio = { cash: study.openingCash, quantities: {} };
      let peak = new Decimal(study.openingCash), maxDrawdown = 0, turnover = new Decimal(0), fees = new Decimal(0);
      let spread = new Decimal(0), slippage = new Decimal(0), orders = 0, eligibleAssetSlots = 0, assetSlots = 0, membershipChanges = 0;
      let previousIds = '', dailyTargets: Readonly<Record<string, number>> = {};
      const curve: { atMs: number; equity: string; maximumAssetWeight: number; concentrationIndex: number;
        effectiveAssetCount: number; cashExposure: number }[] = [];
      const exclusions: Record<string, number> = {}, rejected: Record<string, number> = {};
      for (const slot of dataset.slots) {
        const input = universeStrategyInput(slot, study.anchor, policy);
        // Unknown historical account/catalog evidence invalidates the matched period, not only one candidate.
        if (input.evaluations.some((e) => e.reasons.includes('catalog_asof') || e.reasons.includes('account_fresh') ||
            e.checks.some((c) => c.code === 'account_ready' && c.status === 'unknown'))) throw new Error('missing_historical_eligibility');
        for (const observation of slot.observations.filter((o) => o.evidence.mapping !== null)) {
          const evaluation = evaluateUniverseAsset(observation.evidence, observation.atMs, policy);
          if (evaluation.checks.some((c) => c.status === 'unknown') || evaluation.reasons.some((r) =>
            r.endsWith('_valid_quote') || r.endsWith('_valid_book'))) throw new Error('missing_historical_eligibility');
        }
        if (slot.slotMs % UNIVERSE_DAY === 0) dailyTargets = candidate === 'baseline' ? input.baselineTargets : input.proposedTargets;
        const ids = input.eligibleIds.join(',');
        if (previousIds && previousIds !== ids) membershipChanges += 1;
        previousIds = ids; eligibleAssetSlots += input.eligibleIds.length; assetSlots += input.evaluations.length;
        for (const e of input.evaluations) for (const reason of e.reasons) exclusions[reason] = (exclusions[reason] ?? 0) + 1;
        const step = planUniverseShadow(slot, dailyTargets, portfolio, policy, multiplier, study.guardrails);
        portfolio = step.portfolio;
        const equity = new Decimal(step.equity); peak = Decimal.max(peak, equity);
        maxDrawdown = Math.min(maxDrawdown, equity.div(peak).minus(1).toNumber());
        turnover = turnover.plus(step.turnoverUsd); fees = fees.plus(step.feesUsd);
        spread = spread.plus(step.spreadUsd); slippage = slippage.plus(step.slippageUsd); orders += step.orders.length;
        step.rejected.forEach((r) => r.reasons.forEach((reason) => { rejected[reason] = (rejected[reason] ?? 0) + 1; }));
        curve.push({ atMs: slot.slotMs, equity: step.equity, maximumAssetWeight: step.maximumAssetWeight,
          concentrationIndex: step.concentrationIndex, effectiveAssetCount: step.effectiveAssetCount, cashExposure: step.cashExposure });
      }
      results.push({ candidate, multiplier, netReturn: new Decimal(curve.at(-1)!.equity).div(study.openingCash).minus(1).toNumber(),
        maxDrawdown, turnoverUsd: turnover.toFixed(), turnoverMultiple: turnover.div(study.openingCash).toNumber(),
        feesUsd: fees.toFixed(), spreadUsd: spread.toFixed(), slippageUsd: slippage.toFixed(), orders,
        assetSlots, eligibleAssetSlots, membershipChanges, exclusions, rejected, curve });
    }
  } catch { return { status: 'invalid_evidence' as const, phase, planHash, datasetHash: dataset.datasetHash, results: null }; }
  return { status: 'modeled_only' as const, phase, planHash, datasetHash: dataset.datasetHash,
    universeHash: dataset.universeHash, results: results.map((r) => ({ ...r,
      netReturnDifference: r.netReturn - results.find((b) => b.candidate === 'baseline' && b.multiplier === r.multiplier)!.netReturn })),
    promotion: 'disabled' as const };
}
