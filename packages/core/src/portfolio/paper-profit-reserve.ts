import { BudgetDecimal as D, budgetAmount as a, budgetText as t, identifiedBudgetFact } from '../execution/native-rules.js';
import { capitalHash } from './capital-ledger.js';
import { reserveValue as v, reserveUnavailable as u, reserveMinimum, validateReserveSettings, type ReserveFinancialInput, type ReserveMetric } from './profit-reserve.js';
import type { ReserveCapitalWitness } from './reserve-capital-witness.js';
import { PAPER_RESERVE_VERSION, type PaperReservePolicy, type PaperReserveState, type PaperReserveProposal } from './paper-profit-reserve-types.js';
export function paperReservePolicy(input: Omit<PaperReservePolicy, 'id' | 'version' | 'reviewMode'>): PaperReservePolicy {
  validateReserveSettings(input.settings);
  return identifiedBudgetFact({ ...input, version: PAPER_RESERVE_VERSION, reviewMode: 'every_mutation' as const });
}
/** Funded P2 active/spendable values already exclude current claims. Never subtract them twice. */
export function evaluatePaperReserve(policy: PaperReservePolicy, state: PaperReserveState, f: ReserveFinancialInput, floor: ReserveCapitalWitness, nowMs: number): PaperReserveProposal {
  validateReserveSettings(policy.settings);
  if (state.domain !== PAPER_RESERVE_VERSION || policy.version !== PAPER_RESERVE_VERSION || policy.scopeId !== f.scopeId || state.scopeId !== f.scopeId || state.policyId !== policy.id || floor.scopeId !== f.scopeId) throw new Error('paper_reserve_scope_mismatch');
  const reasons = [...f.reasonCodes];
  for (const metric of [f.economicPnlUsd, f.realizedPnlUsd, f.unrealizedPnlUsd, f.feesUsd, f.incomeUsd, f.priorProfitBackedUsd, f.activeEquityUsd, f.spendableUsd, floor.floorUsd]) if (metric.state === 'unavailable') reasons.push(...metric.reasonCodes);
  if (f.assurance !== 'observed') reasons.push('paper_reserve_observed_evidence_required');
  if (nowMs >= f.expiresAtMs || nowMs >= floor.expiresAtMs || f.observedAtMs === null || nowMs < f.observedAtMs) reasons.push('paper_reserve_expired');
  if (floor.budgetRevision !== f.budgetRevision || !floor.inputHash || floor.objective === 'unbound') reasons.push('operating_requirement_binding_missing');
  if (f.actualPendingUsd.state!=='available')reasons.push('paper_reserve_order_claims_unavailable');
  else if(a(f.actualPendingUsd.value).gt(0))reasons.push('paper_reserve_orders_pending');
  if (a(state.pendingUsd).gt(0)) reasons.push('pending_operation_unresolved');
  for (const [metric, expected] of [[f.actualReservedUsd, state.reservedUsd], [f.actualTaxHoldUsd, state.taxHoldUsd]] as const) {
    if (metric.state !== 'available' || !a(metric.value).eq(expected)) reasons.push('paper_reserve_claim_lineage_unverified');
  }
  // priorProfitBackedUsd is the uniquely reconciled lifetime amount, including this stream.
  const tax = D.max(0, a(policy.settings.taxHold.amountUsd).sub(state.taxHoldUsd));
  if (tax.gt(0) && policy.settings.taxHold.backing === 'unknown') reasons.push('tax_hold_funding_unverified');
  const backing = f.priorProfitBackedUsd.state === 'available' ? a(f.priorProfitBackedUsd.value).add(policy.settings.taxHold.backing === 'profit' ? tax : 0) : null;
  const profitCap = (m: ReserveMetric): ReserveMetric => backing === null ? f.priorProfitBackedUsd : m.state === 'available' ? v(t(D.max(0, a(m.value).sub(backing)))) : m;
  const cash = f.spendableUsd.state === 'available' ? v(t(D.max(0, a(f.spendableUsd.value).sub(tax)))) : f.spendableUsd;
  const capital = f.activeEquityUsd.state !== 'available' ? f.activeEquityUsd : floor.floorUsd.state !== 'available' ? floor.floorUsd : v(t(D.max(0, a(f.activeEquityUsd.value).sub(tax).sub(D.max(policy.settings.retainedCapitalUsd, floor.floorUsd.value)))));
  const caps = { economicUsd: profitCap(f.economicPnlUsd), realizedUsd: profitCap(f.realizedPnlUsd), cashUsd: cash, capitalUsd: capital }, capacity = reserveMinimum(Object.values(caps));
  const p = f.economicPnlUsd.state === 'available' ? a(f.economicPnlUsd.value) : null;
  const fresh = p === null ? new D(0) : D.max(0, p.sub(state.hUsd));
  const threshold = policy.settings.trigger.kind === 'growth_bps' ? a(state.baseUsd).mul(policy.settings.trigger.value).div(10_000) : a(policy.settings.trigger.value);
  if (policy.settings.trigger.kind === 'growth_bps' && !a(state.baseUsd).gt(0)) reasons.push('assessment_base_unavailable');
  const reached = policy.settings.trigger.kind === 'balance_usd' ? !state.balanceConsumed && threshold.gt(state.baseUsd) && fresh.gt(0) &&
    f.activeEquityUsd.state === 'available' && a(f.activeEquityUsd.value).gte(threshold) && p !== null && a(state.baseUsd).add(p).sub(state.baseProfitUsd).gte(threshold) : fresh.gte(threshold);
  const ceiling = state.cycle?.ceilingUsd ?? (reached && p !== null ? t(p.toDecimalPlaces(2, D.ROUND_FLOOR)) : null);
  const disabled = policy.settings.goal === 'keep_invested' || policy.settings.shareBps === 0;
  let r: ReserveMetric = u('paper_reserve_not_evaluated'), g = r, residual = r, retained = r;
  if (!reasons.length && p !== null && capacity.state === 'available') {
    const gc = D.max(0, D.min(p, ceiling ?? p).sub(state.hUsd)).mul(100).floor(), b = policy.settings.shareBps;
    const rc = disabled ? new D(0) : D.min(gc.mul(b).div(10_000).floor(), a(capacity.value).mul(100).floor());
    const Gc = rc.isZero() || b === 0 ? new D(0) : rc.mul(10_000).div(b).ceil();
    if (Gc.gt(gc) || b > 0 && !Gc.mul(b).div(10_000).floor().eq(rc)) throw new Error('paper_reserve_slice_invariant');
    const actionable = !disabled && ceiling !== null && rc.gt(0) && rc.gte(a(policy.settings.minimumBatchUsd).mul(100));
    if (!disabled && !actionable) reasons.push(ceiling === null ? 'milestone_not_reached' : 'below_reserve_batch');
    r = v(actionable ? t(rc.div(100)) : '0'); g = v(actionable ? t(Gc.div(100)) : '0');
    residual = v(actionable ? t(Gc.div(100).mul(b).div(10_000).sub(rc.div(100))) : '0');
    retained = f.activeEquityUsd.state === 'available' ? v(t(a(f.activeEquityUsd.value).sub(actionable ? tax : 0).sub(r.value))) : f.activeEquityUsd;
  }
  const codes = [...new Set(reasons)].sort();
  return identifiedBudgetFact({ version: PAPER_RESERVE_VERSION, scopeId: f.scopeId, policyId: policy.id, stateId: state.id, requirementsId: policy.requirementsId,
    evaluatedAtMs: nowMs, expiresAtMs: Math.min(f.expiresAtMs, floor.expiresAtMs, nowMs + 30_000),
    state: disabled ? 'disabled' as const : codes.some(c => !['milestone_not_reached', 'below_reserve_batch','paper_reserve_orders_pending'].includes(c)) ? 'unavailable' as const : codes.length ? 'deferred' as const : 'eligible' as const,
    reasonCodes: codes, financial: f, operatingRequirement: floor, triggerReached: ceiling !== null,
    wouldRequestReview: policy.settings.reviewWinCount !== null && f.completedWins.state === 'available' && a(f.completedWins.value).gte(policy.settings.reviewWinCount),
    cycleCeilingUsd: ceiling, reserveUsd: r, assessedProfitUsd: g, retainedActiveUsd: retained, additionalTaxUsd: t(tax), roundingResidualUsd: residual, caps,
    inputHash: capitalHash({ policy, state, financial: f, floor, nowMs }), liveExecutionPermitted: false as const, externalWithdrawalPermitted: false as const });
}
