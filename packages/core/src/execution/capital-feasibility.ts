import { capitalHash } from '../portfolio/capital-ledger.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/index.js';
import type { BudgetReportV1 } from './account-budget.js';
import { BudgetDecimal as D, budgetAmount as amount, budgetText as text, nativeRuleReasons, type NativeExecutionRulesV1 } from './native-rules.js';

export interface FeasibilityAssetV1 {
  readonly assetId: string; readonly markUsd: string; readonly rules: NativeExecutionRulesV1;
  readonly quote: { readonly bid: string; readonly ask: string; readonly atMs: number };
}
export interface FeasibilityIntentV1 {
  readonly assetId: string; readonly deltaQuantity: string; readonly reason: 'entry' | 'rebalance' | 'risk_exit'; readonly strategyRef: string;
}
export interface FeasibilityPolicyV1 {
  readonly id: string; readonly maxOrders: number; readonly maxOrderUsd: string; readonly maxTurnoverUsd: string;
  readonly usedTurnoverUsd: string; readonly maxEntryFraction: string;
  readonly maxPositionFraction: string; readonly accountMaxPositionFraction: string;
  readonly maxInvestedFraction: string; readonly accountMaxInvestedFraction: string;
  readonly discretionaryFloorUsd: string; readonly riskExitBypassesDiscretionaryFloor: boolean;
  readonly killSwitchEngaged: boolean;
}
export interface FeasibilityFeesV1 {
  readonly id: string; readonly rate: string; readonly currency: 'USD' | 'received'; readonly fixedUsd: string;
  readonly slippageBps: string; readonly assurance: 'observed' | 'scenario'; readonly expiresAtMs: number;
}
export interface CapitalFeasibilityInputV1 {
  readonly budget: BudgetReportV1; readonly expectedRevision: string; readonly nowMs: number;
  readonly assets: readonly FeasibilityAssetV1[]; readonly intents: readonly FeasibilityIntentV1[];
  readonly policy: FeasibilityPolicyV1; readonly fees: FeasibilityFeesV1;
  readonly proposal?: { readonly id: string; readonly hash: string; readonly revision: number };
  readonly requireFullRequest?: boolean;
}
export interface FeasibleOrderV1 {
  readonly assetId: string; readonly side: 'buy' | 'sell'; readonly requestedQuantity: string;
  readonly quantity: string; readonly deliveredQuantity: string; readonly executionPriceUsd: string;
  readonly notionalUsd: string; readonly cashDebitUsd: string; readonly cashCreditUsd: string; readonly feeUsd: string;
  readonly residualQuantity: string; readonly strategyRefs: readonly string[]; readonly rulesId: string;
}
export interface CapitalFeasibilityReportV1 {
  readonly id: string; readonly version: 'capital-feasibility-v1'; readonly scopeId: string; readonly budgetRevision: string;
  readonly evaluatedAtMs: number; readonly expiresAtMs: number; readonly assurance: 'observed' | 'scenario';
  readonly state: 'feasible' | 'infeasible' | 'unavailable'; readonly executionEligible: boolean;
  readonly orders: readonly FeasibleOrderV1[]; readonly blocked: readonly { readonly assetId: string; readonly reasons: readonly string[] }[];
  readonly reasonCodes: readonly string[]; readonly remainingBuyCashUsd: string | null; readonly projectedCashUsd: string | null;
  readonly projectedEquityUsd: string | null; readonly oneWayTurnoverUsd: string | null; readonly totalFeeUsd: string | null;
  readonly quantities: Readonly<Record<string, string>>; readonly riskResiduals: readonly string[];
  readonly operatingFloor: { readonly state: 'unavailable'; readonly reason: 'no_global_floor_certificate' };
  readonly inputManifest: { readonly budgetId: string; readonly ruleIds: readonly string[]; readonly feeId: string; readonly policyId: string; readonly inputHash: string;
    readonly proposal: { readonly id: string; readonly hash: string; readonly revision: number } | null };
  readonly inputsJson: string;
}

/** Exact bounded planner for this request; a witness is not an optimum or order permission. */
export function evaluateCapitalFeasibility(input: CapitalFeasibilityInputV1): CapitalFeasibilityReportV1 {
  const { budget, policy, fees, nowMs } = input;
  const reasons: string[] = [], blocked: { assetId: string; reasons: string[] }[] = [], orders: FeasibleOrderV1[] = [];
  if (budget.state !== 'available') reasons.push(...budget.reasonCodes);
  if (input.expectedRevision !== budget.revision) reasons.push('budget_revision_stale');
  if (nowMs < budget.evaluatedAtMs || nowMs >= budget.expiresAtMs) reasons.push('budget_source_stale');
  if (budget.activeEquityUsd === null || budget.equityUsd === null || !amount(budget.activeEquityUsd).gt(0)) reasons.push('active_nav_unavailable');
  if (nowMs >= fees.expiresAtMs) reasons.push('fee_terms_stale');
  if (policy.killSwitchEngaged) reasons.push('kill_switch_engaged');
  const rate = amount(fees.rate), fixed = amount(fees.fixedUsd), slip = amount(fees.slippageBps).div(10_000);
  if (rate.lt(0) || rate.gte(1) || fixed.lt(0) || slip.lt(0) || slip.gte(1)) throw new TypeError('feasibility_invalid_cost');
  for (const fraction of [policy.maxEntryFraction, policy.maxPositionFraction, policy.accountMaxPositionFraction,
    policy.maxInvestedFraction, policy.accountMaxInvestedFraction]) if (amount(fraction).lt(0) || amount(fraction).gt(1)) throw new TypeError('feasibility_invalid_policy');
  if (!Number.isSafeInteger(policy.maxOrders) || policy.maxOrders < 0 ||
    [policy.maxOrderUsd, policy.maxTurnoverUsd, policy.usedTurnoverUsd, policy.discretionaryFloorUsd].some(value => amount(value).lt(0))) throw new TypeError('feasibility_invalid_policy');
  const byAsset = new Map(input.assets.map(asset => [asset.assetId, asset]));
  if (byAsset.size !== input.assets.length) throw new TypeError('feasibility_duplicate_asset');
  const quantities = Object.fromEntries(Object.entries(budget.positions).map(([id, quantity]) => [id, amount(quantity)]));
  for (const [id, quantity] of Object.entries(quantities)) if (quantity.gt(0) && !byAsset.has(id)) reasons.push('portfolio_marks_incomplete');
  for (const asset of input.assets) {
    if (!amount(asset.markUsd).gt(0) || !amount(asset.quote.bid).gt(0) || amount(asset.quote.ask).lt(asset.quote.bid)) reasons.push('quote_invalid');
    if (amount(asset.markUsd).lt(asset.quote.bid) || amount(asset.markUsd).gt(asset.quote.ask)) reasons.push('mark_quote_incoherent');
    if (asset.quote.atMs > nowMs + 5_000 || nowMs - asset.quote.atMs > 60_000) reasons.push('quote_stale');
    if (asset.assetId !== asset.rules.assetId) reasons.push('native_identity_mismatch');
    reasons.push(...nativeRuleReasons(asset.rules, nowMs));
  }
  const wanted = new Map<string, { delta: InstanceType<typeof D>; intents: FeasibilityIntentV1[] }>();
  for (const intent of input.intents) {
    if (!byAsset.has(intent.assetId)) reasons.push('native_rules_missing');
    const group = wanted.get(intent.assetId) ?? { delta: new D(0), intents: [] };
    group.delta = group.delta.add(amount(intent.deltaQuantity)); group.intents.push(intent); wanted.set(intent.assetId, group);
  }
  let cash = amount(budget.observedCashUsd ?? '0'), buyCash = amount(budget.spendableUsd ?? '0');
  let equity = amount(budget.equityUsd ?? '0'), active = amount(budget.activeEquityUsd ?? '0');
  let turnover = new D(0), totalFees = new D(0);
  const invested = () => Object.entries(quantities).reduce((sum, [id, quantity]) => sum.add(quantity.mul(byAsset.get(id)?.markUsd ?? '0')), new D(0));
  const ordered = [...wanted].filter(([, group]) => !group.delta.isZero()).sort(([, l], [, r]) => Number(l.delta.gt(0)) - Number(r.delta.gt(0)));
  if (reasons.length === 0) for (const [id, group] of ordered) {
    const asset = byAsset.get(id)!, rule = asset.rules, side = group.delta.lt(0) ? 'sell' as const : 'buy' as const;
    const reject = (reason: string) => blocked.push({ assetId: id, reasons: [reason] });
    const price = amount(side === 'buy' ? asset.quote.ask : asset.quote.bid).mul(side === 'buy' ? slip.add(1) : new D(1).sub(slip));
    const receivedFee = fees.currency === 'received', deliveredFactor = side === 'buy' && receivedFee ? new D(1).sub(rate) : new D(1);
    const lossPerQuantity = side === 'buy' ? price.mul(receivedFee ? 1 : rate.add(1)).sub(deliveredFactor.mul(asset.markUsd))
      : amount(asset.markUsd).sub(price.mul(new D(1).sub(rate)));
    const held = quantities[id] ?? new D(0), available = amount(budget.quantities[id] ?? '0');
    let quantity = group.delta.abs();
    if (side === 'sell') quantity = D.min(quantity, available);
    else {
      quantity = D.min(quantity, D.max(0, buyCash.sub(fixed)).div(price.mul(receivedFee ? 1 : rate.add(1))));
      const caps = [[policy.maxPositionFraction, active, held.mul(asset.markUsd)], [policy.accountMaxPositionFraction, equity, held.mul(asset.markUsd)],
        [policy.maxInvestedFraction, active, invested()], [policy.accountMaxInvestedFraction, equity, invested()]] as const;
      for (const [fraction, nav, current] of caps) {
        const cap = amount(fraction), denominator = deliveredFactor.mul(asset.markUsd).add(cap.mul(lossPerQuantity));
        if (denominator.gt(0)) quantity = D.min(quantity, D.max(0, cap.mul(nav.sub(fixed)).sub(current)).div(denominator));
      }
      quantity = D.min(quantity, amount(policy.maxEntryFraction).mul(active.sub(fixed)).div(price.add(amount(policy.maxEntryFraction).mul(lossPerQuantity))));
    }
    quantity = D.min(quantity, amount(policy.maxOrderUsd).div(price),
      D.max(0, amount(policy.maxTurnoverUsd).sub(policy.usedTurnoverUsd).sub(turnover)).div(price));
    if (rule.quantityMax.state === 'known') quantity = D.min(quantity, rule.quantityMax.value);
    if (rule.quoteMax.state === 'known') quantity = D.min(quantity, amount(rule.quoteMax.value).div(price));
    const increment = amount(rule.quantityIncrement.state === 'known' ? rule.quantityIncrement.value : '1');
    quantity = D.max(0, quantity).div(increment).floor().mul(increment);
    const notional = quantity.mul(price);
    if (quantity.isZero() || rule.quantityMin.state === 'known' && quantity.lt(rule.quantityMin.value) ||
      rule.quoteMin.state === 'known' && notional.lt(rule.quoteMin.value)) { reject('native_minimum_not_met'); continue; }
    const riskExit = side === 'sell' && group.intents.every(intent => intent.reason === 'risk_exit');
    if (notional.lt(policy.discretionaryFloorUsd) && !(riskExit && policy.riskExitBypassesDiscretionaryFloor)) { reject('discretionary_floor_not_met'); continue; }
    if (orders.length >= policy.maxOrders) { reject('order_count_limit'); continue; }
    const fee = notional.mul(rate).add(fixed);
    const debit = side === 'buy' ? notional.add(receivedFee ? 0 : notional.mul(rate)).add(fixed) : fixed;
    const credit = side === 'sell' ? notional.mul(new D(1).sub(rate)) : new D(0);
    if (debit.gt(buyCash)) { reject('cash_unavailable'); continue; }
    const delivered = side === 'buy' ? quantity.mul(deliveredFactor) : quantity;
    quantities[id] = side === 'buy' ? held.add(delivered) : held.sub(quantity);
    cash = cash.sub(debit).add(credit); buyCash = buyCash.sub(debit); // Unfilled sales never fund a buy.
    equity = equity.sub(lossPerQuantity.mul(quantity)).sub(fixed); active = active.sub(lossPerQuantity.mul(quantity)).sub(fixed);
    turnover = turnover.add(notional); totalFees = totalFees.add(fee);
    orders.push({ assetId: id, side, requestedQuantity: text(group.delta.abs()), quantity: text(quantity),
      deliveredQuantity: text(delivered), executionPriceUsd: text(price), notionalUsd: text(notional), cashDebitUsd: text(debit),
      cashCreditUsd: text(credit), feeUsd: text(fee), residualQuantity: text(quantities[id]!),
      strategyRefs: [...new Set(group.intents.map(intent => intent.strategyRef))].sort(), rulesId: rule.id });
  }
  const residuals: string[] = [];
  if (input.requireFullRequest) for (const [id, group] of wanted) {
    const order = orders.find(row => row.assetId === id);
    if (group.intents.length > 1 || !group.delta.isZero() && (!order || !amount(order.quantity).eq(group.delta.abs())))
      blocked.push({ assetId: id, reasons: ['proposal_partial_execution_requires_revision'] });
  }
  for (const [id, group] of wanted) if (group.delta.lt(0) && group.intents.every(intent => intent.reason === 'risk_exit') &&
    group.delta.abs().gte(budget.positions[id] ?? '0') && (quantities[id] ?? new D(0)).gt(0)) residuals.push(`risk_exit_residual:${id}:${text(quantities[id]!)}`);
  if (active.gt(0) && equity.gt(0)) {
    for (const [id, quantity] of Object.entries(quantities)) {
      const value = quantity.mul(byAsset.get(id)?.markUsd ?? 0);
      if (value.gt(active.mul(policy.maxPositionFraction)) || value.gt(equity.mul(policy.accountMaxPositionFraction))) residuals.push(`position_limit:${id}`);
    }
    if (invested().gt(active.mul(policy.maxInvestedFraction)) || invested().gt(equity.mul(policy.accountMaxInvestedFraction))) residuals.push('invested_limit');
  } else if (orders.length > 0) residuals.push('nonpositive_post_cost_nav');
  const assurance = budget.assurance === 'scenario' || fees.assurance === 'scenario' || input.assets.some(asset => asset.rules.assurance === 'scenario') ? 'scenario' as const : 'observed' as const;
  const body = { version: 'capital-feasibility-v1' as const, scopeId: budget.scopeId, budgetRevision: budget.revision, evaluatedAtMs: nowMs,
    expiresAtMs: Math.min(budget.expiresAtMs, fees.expiresAtMs, nowMs + 60_000, ...input.assets.map(asset => Math.min(asset.rules.expiresAtMs, asset.quote.atMs + 60_000))),
    assurance, state: reasons.some(reason => !['native_trading_disabled', 'kill_switch_engaged'].includes(reason)) ? 'unavailable' as const : reasons.length || blocked.length || residuals.length ? 'infeasible' as const : 'feasible' as const,
    executionEligible: false, orders, blocked, reasonCodes: [...new Set(reasons)].sort(),
    remainingBuyCashUsd: reasons.length ? null : text(buyCash), projectedCashUsd: reasons.length ? null : text(cash),
    projectedEquityUsd: reasons.length ? null : text(equity), oneWayTurnoverUsd: reasons.length ? null : text(turnover), totalFeeUsd: reasons.length ? null : text(totalFees),
    quantities: Object.fromEntries(Object.entries(quantities).map(([id, quantity]) => [id, text(quantity)])), riskResiduals: residuals,
    operatingFloor: { state: 'unavailable' as const, reason: 'no_global_floor_certificate' as const },
    inputsJson: canonicalJson(input as unknown as CanonicalJsonValue),
    inputManifest: { budgetId: budget.id, ruleIds: input.assets.map(asset => asset.rules.id).sort(), feeId: fees.id, policyId: policy.id,
      inputHash: capitalHash(input), proposal: input.proposal ?? null } };
  return { ...body, id: capitalHash(body) };
}
