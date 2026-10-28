import { BudgetDecimal as D, budgetAmount as a, budgetText as t, identifiedBudgetFact } from '../execution/native-rules.js';
import { evaluateCapitalFeasibility, type CapitalFeasibilityInputV1 } from '../execution/capital-feasibility.js';
import { capitalHash } from './capital-ledger.js';

export interface PaperReserveSaleLot {
  readonly id: string; readonly assetId: string; readonly quantity: string; readonly basisUsd: string | null;
  readonly acquiredAtMs: number; readonly sequence: number; readonly evidenceRef: string;
}
/** A reviewed, fixed objective. These are supplied by the financial assembler, never a permission. */
export interface PaperReserveSaleObjective {
  readonly reserveUsd: string; readonly economicBackingUsd: string; readonly realizedBackingUsd: string;
  readonly freshProfitUsd: string; readonly shareBps: number; readonly additionalTaxUsd: string; readonly profitBackedTaxUsd: string;
  readonly retainedFloorUsd: string; readonly maxCostUsd: string; readonly maxNotionalUsd: string;
  readonly maxExposureReductionUsd: string; readonly eligibleAssetIds: readonly string[]; readonly reviewRef: string;
}
export interface PaperReserveSaleInput {
  readonly frame: CapitalFeasibilityInputV1; readonly lots: readonly PaperReserveSaleLot[];
  readonly objective: PaperReserveSaleObjective; readonly policyId: string; readonly stateId: string;
}
export interface PaperReserveSaleCandidate {
  readonly assetId: string; readonly state: 'modeled' | 'infeasible' | 'unavailable'; readonly reasons: readonly string[];
  readonly quantity: string | null; readonly notionalUsd: string | null; readonly costUsd: string | null;
  readonly realizedGainUsd: string | null; readonly netProceedsUsd: string | null; readonly residualQuantity: string | null;
  readonly feasibilityId: string | null;
}
export interface PaperReserveSaleConsequence {
  readonly id: string; readonly version: 'paper-reserve-sale-v1'; readonly scopeId: string; readonly budgetRevision: string;
  readonly policyId: string; readonly stateId: string; readonly inputHash: string; readonly expiresAtMs: number;
  readonly state: 'modeled' | 'already_funded' | 'infeasible' | 'unavailable'; readonly reasons: readonly string[];
  readonly candidates: readonly PaperReserveSaleCandidate[]; readonly selectedAssetId: string | null;
  readonly objective: PaperReserveSaleObjective; readonly minimumWithinSupportedCandidates: boolean;
  readonly fundsEligibility: false; readonly orderSubmissionPermitted: false; readonly externalWithdrawalPermitted: false;
}

/** Minimum notional among declared single-asset FIFO sales, not a multi-asset optimization.
 * Affine inequalities are intersected on every FIFO lot segment, then rounded UP to the
 * legal quantity increment and checked through P2. Modeled proceeds never fund a claim.
 */
export function preparePaperReserveSale(input: PaperReserveSaleInput): PaperReserveSaleConsequence {
  const { frame: f, objective: o } = input, b = f.budget;
  const reasons: string[] = [];
  if (!o.reviewRef || !input.policyId || !input.stateId) reasons.push('sale_objective_review_missing');
  if (!o.eligibleAssetIds.length || o.eligibleAssetIds.length > 10 || f.assets.length > 10 || Object.keys(b.positions).length > 10 ||
      new Set(o.eligibleAssetIds).size !== o.eligibleAssetIds.length || input.lots.length > 1024) throw new Error('sale_inventory_bound');
  if (!Number.isSafeInteger(o.shareBps) || o.shareBps < 1 || o.shareBps > 10_000) throw new Error('sale_share_invalid');
  for (const key of ['reserveUsd','economicBackingUsd','realizedBackingUsd','freshProfitUsd','additionalTaxUsd','profitBackedTaxUsd','retainedFloorUsd','maxCostUsd','maxNotionalUsd','maxExposureReductionUsd'] as const) {
    if (a(o[key]).lt(0) && !['economicBackingUsd','realizedBackingUsd','freshProfitUsd'].includes(key)) throw new Error('sale_objective_invalid');
  }
  const reserve = a(o.reserveUsd), tax = a(o.additionalTaxUsd), backedTax = a(o.profitBackedTaxUsd);
  if (!reserve.gt(0) || !reserve.mul(100).isInteger() || backedTax.gt(tax)) throw new Error('sale_objective_invalid');
  const validation = evaluateCapitalFeasibility({ ...f, intents: [] });
  reasons.push(...validation.reasonCodes);
  if (b.activeEquityUsd === null || b.equityUsd === null || b.spendableUsd === null) reasons.push('sale_budget_unavailable');
  // V1 supports the P2 affine fee/slippage form only. No tier change or personal-tax estimate.
  const fixed = a(f.fees.fixedUsd), netPriceFactor = new D(1).sub(f.fees.rate), slip = a(f.fees.slippageBps).div(10_000);
  const requiredProfit = reserve.mul(100).mul(10_000).div(o.shareBps).ceil().div(100);
  const finish = (state: PaperReserveSaleConsequence['state'], candidates: PaperReserveSaleCandidate[], codes: readonly string[], selectedAssetId: string | null = null): PaperReserveSaleConsequence => identifiedBudgetFact({
    version: 'paper-reserve-sale-v1' as const, scopeId: b.scopeId, budgetRevision: b.revision, policyId: input.policyId, stateId: input.stateId,
    inputHash: capitalHash(input), expiresAtMs: Math.min(validation.expiresAtMs, ...f.assets.map(x => x.rules.observedAtMs + 30_000)), state, reasons: [...new Set(codes)].sort(), candidates, selectedAssetId,
    objective: o, minimumWithinSupportedCandidates: state === 'modeled' && !candidates.some(c => c.state === 'unavailable'),
    fundsEligibility: false as const, orderSubmissionPermitted: false as const, externalWithdrawalPermitted: false as const,
  });
  if (reasons.length) return finish('unavailable', [], reasons);
  const active = a(b.activeEquityUsd!), equity = a(b.equityUsd!), cash = a(b.spendableUsd!);
  if (a(o.economicBackingUsd).gte(reserve.add(backedTax)) && a(o.realizedBackingUsd).gte(reserve.add(backedTax)) &&
      a(o.freshProfitUsd).gte(requiredProfit) && cash.gte(reserve.add(tax)) && active.sub(reserve).sub(tax).gte(o.retainedFloorUsd) && !validation.riskResiduals.length) {
    // Verify exposure against the reduced active denominator, even without a sale.
    const after = { ...b, activeEquityUsd: t(active.sub(reserve).sub(tax)), spendableUsd: t(cash.sub(reserve).sub(tax)) };
    if (evaluateCapitalFeasibility({ ...f, budget: after, intents: [] }).riskResiduals.length === 0) return finish('already_funded', [], ['sale_not_needed']);
  }
  const candidates = [...o.eligibleAssetIds].sort().map((assetId): PaperReserveSaleCandidate => {
    const empty = (state: 'infeasible' | 'unavailable', ...codes: string[]): PaperReserveSaleCandidate => ({ assetId, state, reasons: codes,
      quantity: null, notionalUsd: null, costUsd: null, realizedGainUsd: null, netProceedsUsd: null, residualQuantity: null, feasibilityId: null });
    const asset = f.assets.find(x => x.assetId === assetId);
    if (!asset) return empty('unavailable', 'sale_asset_evidence_missing');
    const held = a(b.positions[assetId] ?? '0'), available = a(b.quantities[assetId] ?? '0');
    if (!held.gt(0) || !available.gt(0)) return empty('infeasible', 'sale_quantity_unavailable');
    const lots = input.lots.filter(l => l.assetId === assetId).sort((l, r) => l.acquiredAtMs - r.acquiredAtMs || l.sequence - r.sequence);
    if (!lots.length || lots.some(l => l.basisUsd === null || !l.evidenceRef || !a(l.quantity).gt(0) || a(l.basisUsd).lt(0) ||
        !Number.isSafeInteger(l.acquiredAtMs) || !Number.isSafeInteger(l.sequence) || l.acquiredAtMs > f.nowMs || l.sequence < 0) ||
        new Set(lots.map(l => l.id)).size !== lots.length || new Set(lots.map(l => `${l.acquiredAtMs}:${l.sequence}`)).size !== lots.length ||
        !lots.reduce((sum,l) => sum.add(l.quantity), new D(0)).eq(held)) return empty('unavailable', 'sale_fifo_basis_or_order_unverified');
    const price = a(asset.quote.bid).mul(new D(1).sub(slip)), net = price.mul(netPriceFactor), mark = a(asset.markUsd), loss = mark.sub(net);
    if (loss.lt(0) || !net.gt(0)) return empty('unavailable', 'sale_cost_form_unsupported');
    if (cash.lt(fixed)) return empty('infeasible', 'sale_fixed_fee_not_prefunded');
    const rule = asset.rules;
    if (rule.quantityIncrement.state !== 'known' || rule.quantityMin.state !== 'known') return empty('unavailable', 'sale_native_increment_missing');
    const increment = a(rule.quantityIncrement.value);
    let prefix = new D(0), basis = new D(0);
    for (const lot of lots) {
      const end = prefix.add(lot.quantity), unitBasis = a(lot.basisUsd!).div(lot.quantity), intercept = basis.sub(prefix.mul(unitBasis));
      let lower = D.max(prefix, rule.quantityMin.value), upper = D.min(end, available, a(o.maxNotionalUsd).div(price), a(o.maxExposureReductionUsd).div(mark),
        a(f.policy.maxOrderUsd).div(price), D.max(0, a(f.policy.maxTurnoverUsd).sub(f.policy.usedTurnoverUsd)).div(price));
      if (rule.quantityMax.state === 'known') upper = D.min(upper, rule.quantityMax.value);
      if (rule.quoteMax.state === 'known') upper = D.min(upper, a(rule.quoteMax.value).div(price));
      if (rule.quoteMin.state === 'known') lower = D.max(lower, a(rule.quoteMin.value).div(price));
      lower = D.max(lower, a(f.policy.discretionaryFloorUsd).div(price));
      let possible = f.policy.maxOrders >= 1;
      // Restrict c + slope*q >= 0. Negative-gain FIFO lots may impose upper bounds.
      const restrict = (c: InstanceType<typeof D>, slope: InstanceType<typeof D>) => {
        if (slope.gt(0)) lower = D.max(lower, c.neg().div(slope));
        else if (slope.lt(0)) upper = D.min(upper, c.div(slope.neg()));
        else if (c.lt(0)) possible = false;
      };
      restrict(cash.sub(fixed).sub(reserve).sub(tax), net);
      restrict(a(o.realizedBackingUsd).sub(fixed).sub(intercept).sub(reserve).sub(backedTax), net.sub(unitBasis));
      for (const margin of [a(o.economicBackingUsd).sub(reserve).sub(backedTax), a(o.freshProfitUsd).sub(requiredProfit),
        active.sub(reserve).sub(tax).sub(o.retainedFloorUsd), a(o.maxCostUsd)]) restrict(margin.sub(fixed), loss.neg());
      let total = new D(0);
      for (const [id, q] of Object.entries(b.positions)) {
        const other = f.assets.find(x => x.assetId === id);
        if (!other && a(q).gt(0)) return empty('unavailable', 'sale_portfolio_marks_missing');
        const value = a(q).mul(other?.markUsd ?? '0'), reduction = id === assetId ? mark : new D(0); total = total.add(value);
        for (const [cap, nav] of [[f.policy.maxPositionFraction, active.sub(reserve).sub(tax)], [f.policy.accountMaxPositionFraction, equity]] as const) {
          restrict(a(cap).mul(nav.sub(fixed)).sub(value), reduction.sub(a(cap).mul(loss)));
        }
      }
      for (const [cap, nav] of [[f.policy.maxInvestedFraction, active.sub(reserve).sub(tax)], [f.policy.accountMaxInvestedFraction, equity]] as const) restrict(a(cap).mul(nav.sub(fixed)).sub(total), mark.sub(a(cap).mul(loss)));
      const quantity = lower.div(increment).ceil().mul(increment);
      if (possible && quantity.gt(0) && quantity.lte(upper)) {
        const report = evaluateCapitalFeasibility({ ...f, intents: [{ assetId, deltaQuantity: t(quantity.neg()), reason: 'rebalance', strategyRef: `reserve-sale:${input.policyId}:${input.stateId}` }], requireFullRequest: true });
        const order = report.orders[0];
        if (report.state !== 'feasible' || !order || !a(order.quantity).eq(quantity)) return empty('unavailable', 'sale_p2_verification_failed', ...report.reasonCodes, ...report.riskResiduals, ...report.blocked.flatMap(x => x.reasons));
        return { assetId, state: 'modeled', reasons: ['post_fill_operating_request_and_reserve_reassessment_required'], quantity: t(quantity), notionalUsd: order.notionalUsd,
          costUsd: t(quantity.mul(loss).add(fixed)), realizedGainUsd: t(quantity.mul(net.sub(unitBasis)).sub(intercept).sub(fixed)), netProceedsUsd: t(quantity.mul(net).sub(fixed)),
          residualQuantity: t(held.sub(quantity)), feasibilityId: report.id };
      }
      prefix = end; basis = basis.add(lot.basisUsd!);
    }
    return empty('infeasible', 'sale_no_supported_single_asset_solution');
  });
  const modeled = candidates.filter(c => c.state === 'modeled').sort((l, r) => a(l.notionalUsd!).cmp(r.notionalUsd!) || l.assetId.localeCompare(r.assetId));
  return finish(modeled.length ? 'modeled' : candidates.some(c => c.state === 'unavailable') ? 'unavailable' : 'infeasible', candidates,
    ['hypothetical_only', 'separate_order_review_required', 'post_fill_reassessment_required'], modeled[0]?.assetId ?? null);
}
