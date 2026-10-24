import { evaluateCapitalFeasibility, type CapitalFeasibilityInputV1 } from '../execution/capital-feasibility.js';
import { BudgetDecimal as D, budgetAmount as amount, budgetText as text, identifiedBudgetFact } from '../execution/native-rules.js';
import { capitalHash } from './capital-ledger.js';
import { reserveUnavailable, reserveValue, type ReserveMetric } from './profit-reserve.js';

export interface ReserveCapitalWitness {
  readonly version: 'reserve-capital-witness-v1'; readonly scopeId: string; readonly budgetRevision: string | null;
  readonly objective: 'fixed_request' | 'cash_only' | 'unbound'; readonly floorUsd: ReserveMetric;
  readonly inputHash: string | null; readonly fullReportHash: string | null; readonly expiresAtMs: number;
  readonly constraints: readonly { readonly reason: string; readonly minimumUsd: string }[];
}
export function unavailableReserveCapital(scopeId: string, budgetRevision: string | null, expiresAtMs: number, ...reasons: string[]): ReserveCapitalWitness {
  return { version: 'reserve-capital-witness-v1', scopeId, budgetRevision, objective: 'unbound', floorUsd: reserveUnavailable(...reasons), inputHash: null, fullReportHash: null, expiresAtMs, constraints: [] };
}
/** Reservation changes the active denominator and free cash; total account equity is unchanged. */
export function reserveHypotheticalFrame(frame: CapitalFeasibilityInputV1, reserveUsd: string): CapitalFeasibilityInputV1 {
  const b = frame.budget, r = amount(reserveUsd);
  if (r.lt(0) || b.activeEquityUsd === null || b.spendableUsd === null || r.gt(b.activeEquityUsd) || r.gt(b.spendableUsd)) throw new Error('reserve_capital_exceeded');
  const budget = identifiedBudgetFact({ ...b, revision: capitalHash({ original: b.revision, hypotheticalReserveUsd: text(r) }),
    activeEquityUsd: text(amount(b.activeEquityUsd).sub(r)), spendableUsd: text(amount(b.spendableUsd).sub(r)), assurance: 'scenario' as const, executionEligible: false });
  return { ...frame, budget, expectedRevision: budget.revision, requireFullRequest: true };
}
/** Sufficient bounds for the exact fixed-quantity P2 form, verified by its full request evaluator. */
export function reserveCapitalWitness(frame: CapitalFeasibilityInputV1, objective: 'fixed_request' | 'cash_only' = 'fixed_request'): ReserveCapitalWitness {
  const b = frame.budget, p = frame.policy, expiresAtMs = Math.min(b.expiresAtMs, frame.fees.expiresAtMs, ...frame.assets.map(a => Math.min(a.rules.expiresAtMs, a.quote.atMs + 30_000)));
  const unavailable = (...codes: string[]) => unavailableReserveCapital(b.scopeId, b.revision, expiresAtMs, ...codes);
  if (b.state !== 'available' || b.activeEquityUsd === null || b.equityUsd === null || b.spendableUsd === null) return unavailable(...b.reasonCodes, 'operating_requirement_unavailable');
  const assets = new Map(frame.assets.map(a => [a.assetId, a]));
  if(frame.nowMs < b.observedAtMs || frame.nowMs >= b.expiresAtMs) return unavailable('budget_source_stale');
  let marked = new D(0);
  for(const [id,q] of Object.entries(b.positions)) {
    const asset=assets.get(id); if(!asset && amount(q).gt(0)) return unavailable('portfolio_marks_incomplete');
    if(asset) marked=marked.add(amount(q).mul(asset.markUsd));
  }
  if(b.observedCashUsd===null || !marked.add(b.observedCashUsd).eq(b.equityUsd)) return unavailable('unsupported_equity_components');
  if (objective === 'cash_only') {
    if (frame.intents.length || Object.values(b.positions).some(q => amount(q).gt(0))) return unavailable('cash_only_objective_has_positions');
    return { version: 'reserve-capital-witness-v1', scopeId: b.scopeId, budgetRevision: b.revision, objective, floorUsd: reserveValue('0'), inputHash: capitalHash(frame), fullReportHash: null, expiresAtMs, constraints: [] };
  }
  if (!frame.intents.length || frame.intents.some((i, n) => frame.intents.findIndex(j => j.assetId === i.assetId) !== n)) return unavailable('fixed_strategy_request_missing_or_unnetted');
  const reference = evaluateCapitalFeasibility({ ...frame, requireFullRequest: true });
  if (reference.state !== 'feasible' || reference.orders.length !== frame.intents.length) return unavailable(...reference.reasonCodes, ...reference.blocked.flatMap(r => r.reasons), ...reference.riskResiduals, 'fixed_request_not_fully_feasible');
  const quantities = Object.fromEntries(Object.entries(b.positions).map(([id, q]) => [id, amount(q)]));
  const constraints: { reason: string; minimumUsd: string }[] = [{ reason: 'positive_retained_nav', minimumUsd: '0.01' }];
  let invalid = false, loss = new D(0), debits = new D(0);
  const bound = (reason: string, value: InstanceType<typeof D>, fraction: string) => {
    const f = amount(fraction); if (f.lte(0)) { if (value.gt(0)) invalid = true; return; }
    constraints.push({ reason, minimumUsd: text(value.div(f).add(loss)) });
  };
  const risks = () => {
    let invested = new D(0);
    for (const [id, q] of Object.entries(quantities)) {
      const asset = assets.get(id); if (!asset) { if (q.gt(0)) invalid = true; continue; }
      const v = q.mul(asset.markUsd); invested = invested.add(v); bound(`position:${id}`, v, p.maxPositionFraction);
      if (v.gt(amount(b.equityUsd!).sub(loss).mul(p.accountMaxPositionFraction))) invalid = true;
    }
    bound('invested', invested, p.maxInvestedFraction);
    if (invested.gt(amount(b.equityUsd!).sub(loss).mul(p.accountMaxInvestedFraction))) invalid = true;
  };
  risks();
  for (const order of reference.orders) {
    const asset = assets.get(order.assetId)!;
    const old = quantities[order.assetId] ?? new D(0);
    quantities[order.assetId] = order.side === 'buy' ? old.add(order.deliveredQuantity) : old.sub(order.quantity);
    const lossHere = order.side === 'buy' ? amount(order.cashDebitUsd).sub(amount(order.deliveredQuantity).mul(asset.markUsd)) : amount(order.quantity).mul(asset.markUsd).add(order.cashDebitUsd).sub(order.cashCreditUsd);
    if (lossHere.lt(0)) return unavailable('operating_cost_form_unsupported');
    loss = loss.add(lossHere); debits = debits.add(order.cashDebitUsd);
    constraints.push({ reason: 'buy_cash_before_sale_proceeds', minimumUsd: text(amount(b.activeEquityUsd).sub(b.spendableUsd).add(debits)) });
    if (order.side === 'buy') bound(`entry:${order.assetId}`, amount(order.notionalUsd), p.maxEntryFraction);
    risks();
  }
  if (invalid) return unavailable('retained_constraints_incompatible');
  const floor = D.max(...constraints.map(c => amount(c.minimumUsd))).toDecimalPlaces(2, D.ROUND_CEIL);
  if (floor.gt(b.activeEquityUsd)) return unavailable('retained_requirement_exceeds_current_capital');
  const r = amount(b.activeEquityUsd).sub(floor);
  if (r.gt(b.spendableUsd)) return unavailable('retained_cash_constraint_unproved');
  const proof = evaluateCapitalFeasibility(reserveHypotheticalFrame(frame, text(r)));
  if (proof.state !== 'feasible') return unavailable('retained_requirement_sufficiency_unproved');
  return { version: 'reserve-capital-witness-v1', scopeId: b.scopeId, budgetRevision: b.revision, objective, floorUsd: reserveValue(text(floor), [proof.id]),
    inputHash: capitalHash(frame), fullReportHash: proof.id, expiresAtMs: Math.min(expiresAtMs, proof.expiresAtMs), constraints };
}
