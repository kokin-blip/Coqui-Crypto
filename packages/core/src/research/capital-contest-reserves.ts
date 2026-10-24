/** Separately versioned counterfactual for offline P5 only. Original realized evidence is retained.
 * Operational P3 reducers reject these previews because the evaluation identity differs. */
import { BudgetDecimal as D,budgetAmount as amount,budgetText as text,identifiedBudgetFact } from '../execution/native-rules.js';
import { capitalHash } from '../portfolio/capital-ledger.js';
import { canonicalJson,type CanonicalJsonValue } from '../evidence/index.js';
import {reserveMinimum,reserveValue,reserveUnavailable,reserveTrigger,validateReserveSettings,type ReservePolicy,type ReserveState,type ReserveFinancialInput,type ReservePreview,type ReserveMetric} from '../portfolio/profit-reserve.js';
import {reserveBaseline,openReserveCycle,type ReserveAssessment} from '../portfolio/profit-reserve-state.js';
import {reserveCapitalWitness,type ReserveCapitalWitness} from '../portfolio/reserve-capital-witness.js';
import {replayReserveFinancial} from './capital-replay-reserves.js';
import type {ReplayBook} from './capital-replay-book.js';
import type {ReplayPendingOrder} from './capital-replay-execution.js';
import type {CapitalReplaySpecV1,ReplayVariant,ReplayMarketFrame} from './capital-replay-types.js';
import type {FeasibilityIntentV1} from '../execution/capital-feasibility.js';
export function evaluateEconomicCashReview(policy: ReservePolicy, state: ReserveState, f: ReserveFinancialInput, floor: ReserveCapitalWitness, nowMs: number): ReservePreview {
  validateReserveSettings(policy.settings);
  if (policy.scopeId !== state.scopeId || state.scopeId !== f.scopeId || state.policyId !== policy.id || floor.scopeId !== f.scopeId || state.domain !== 'preview') throw new TypeError('reserve_scope_mismatch');
  const reasons = [...f.reasonCodes], trigger = reserveTrigger(policy, state, f), p = f.economicPnlUsd;
  if (state.baseline !== 'ready') reasons.push('assessment_baseline_unavailable');
  if (trigger.threshold.state === 'unavailable') reasons.push(...trigger.threshold.reasonCodes);
  for (const metric of [f.realizedPnlUsd, f.unrealizedPnlUsd, f.feesUsd, f.incomeUsd]) if (metric.state === 'unavailable') reasons.push(...metric.reasonCodes);
  if (nowMs >= floor.expiresAtMs) reasons.push('operating_requirement_expired');
  if (nowMs >= f.expiresAtMs || f.observedAtMs === null || nowMs < f.observedAtMs) reasons.push('preview_expired');
  if (amount(state.pendingUsd).gt(0)) reasons.push('pending_operation_unresolved');
  if (f.spendableUsd.state === 'available' && amount(state.reservedUsd).add(state.taxHoldUsd).gt(f.spendableUsd.value)) reasons.push('modeled_reserve_underfunded');
  if (amount(policy.settings.taxHold.amountUsd).gt(0) && policy.settings.taxHold.backing === 'unknown') reasons.push('tax_hold_funding_unverified');
  const currentCeiling = state.cycle?.ceilingUsd ?? (trigger.reached && p.state === 'available' ? amount(p.value).toDecimalPlaces(2, D.ROUND_FLOOR).toFixed() : null);
  const g = p.state === 'available' ? reserveValue(text(D.max(0, D.min(p.value, currentCeiling ?? p.value).sub(state.hUsd)))) :
    p.state === 'unavailable' ? p : reserveValue('0');
  const tax = amount(policy.settings.taxHold.amountUsd), newTax = D.max(0, tax.sub(state.taxHoldUsd));
  const backing = policy.settings.taxHold.backing === 'profit' ? newTax : new D(0);
  const prior = f.priorProfitBackedUsd.state === 'available' ? amount(f.priorProfitBackedUsd.value).add(state.allocatedUsd).add(state.profitBackedTaxUsd).add(backing) : null;
  const cap = (metric: ReserveMetric) => prior === null ? f.priorProfitBackedUsd : metric.state === 'available' ? reserveValue(text(D.max(0, amount(metric.value).sub(prior)))) : metric;
  const cash = f.spendableUsd.state === 'available' ? reserveValue(text(D.max(0, amount(f.spendableUsd.value).sub(state.reservedUsd).sub(state.taxHoldUsd).sub(newTax)))) : f.spendableUsd;
  const capital = f.activeEquityUsd.state !== 'available' ? f.activeEquityUsd : floor.floorUsd.state !== 'available' ? floor.floorUsd :
    reserveValue(text(D.max(0, amount(f.activeEquityUsd.value).sub(state.reservedUsd).sub(state.taxHoldUsd).sub(newTax).sub(D.max(policy.settings.retainedCapitalUsd, floor.floorUsd.value)))));
  const caps = { economicUsd: cap(p), realizedUsd: cap(f.realizedPnlUsd), cashUsd: cash, capitalUsd: capital };
  const capacity = reserveMinimum([caps.economicUsd,caps.cashUsd,caps.capitalUsd]);
  const missing = [g, capacity].flatMap(v => v.state === 'unavailable' ? v.reasonCodes : []); reasons.push(...missing);
  if (floor.floorUsd.state === 'available' && floor.budgetRevision !== f.budgetRevision) reasons.push('operating_requirement_binding_missing');
  const disabled = policy.settings.goal === 'keep_invested' || policy.settings.shareBps === 0;
  let r: ReserveMetric = reserveUnavailable(...(reasons.length ? reasons : ['reserve_not_evaluated'])), G = r, residual = r, retained = r;
  const activeCycle = state.cycle !== null || trigger.reached;
  if (!reasons.length && g.state === 'available' && capacity.state === 'available') {
    const gc = amount(g.value).mul(100).floor(), cc = amount(capacity.value).mul(100).floor(), b = policy.settings.shareBps;
    const rc = disabled ? new D(0) : D.min(gc.mul(b).div(10_000).floor(), cc);
    const Gc = rc.isZero() || b === 0 ? new D(0) : rc.mul(10_000).div(b).ceil();
    if (Gc.gt(gc) || b > 0 && !Gc.mul(b).div(10_000).floor().eq(rc)) throw new Error('reserve_slice_invariant');
    const actionable = !disabled && activeCycle && rc.gt(0) && rc.gte(amount(policy.settings.minimumBatchUsd).mul(100));
    if (!disabled && !activeCycle) reasons.push('milestone_not_reached');
    else if (!disabled && !actionable) reasons.push(gc.lte(0) ? 'no_new_profit_after_losses' : rc.lt(amount(policy.settings.minimumBatchUsd).mul(100)) ? 'below_reserve_batch' : 'reserve_capacity_unavailable');
    r = reserveValue(actionable ? text(rc.div(100)) : '0'); G = reserveValue(actionable ? text(Gc.div(100)) : '0');
    residual = reserveValue(actionable ? text(Gc.div(100).mul(b).div(10_000).sub(rc.div(100))) : '0');
    retained = f.activeEquityUsd.state === 'available' ? reserveValue(text(amount(f.activeEquityUsd.value).sub(state.reservedUsd).sub(state.taxHoldUsd).sub(newTax).sub(r.value))) : f.activeEquityUsd;
  }
  const desired = g.state === 'available' ? amount(g.value).mul(policy.settings.shareBps).div(10_000).toDecimalPlaces(2, D.ROUND_FLOOR) : null;
  const shortfall = cash.state !== 'available' ? cash : desired === null ? g : reserveValue(text(D.max(0, desired.sub(cash.value))));
  const inputs = { hypothesis:'contest-economic-cash-cap-v1', policy, state, financial: f, floor, nowMs }, codes = [...new Set(reasons)].sort();
  return identifiedBudgetFact({ version: 'profit-reserve-preview-v1' as const, mode: 'preview_only' as const, scopeId: f.scopeId, policyId: policy.id, stateId: state.id,
    evaluatedAtMs: nowMs, expiresAtMs: Math.min(f.expiresAtMs, floor.expiresAtMs, nowMs + 30_000), assurance: f.assurance, executionEligible: false as const, liveExecutionPermitted: false as const,
    state: disabled ? 'disabled' as const : missing.length || codes.some(c => !['milestone_not_reached', 'no_new_profit_after_losses', 'below_reserve_batch'].includes(c)) ? 'unavailable' as const : codes.length ? 'deferred' as const : 'eligible' as const,
    reasonCodes: codes, financial: f, modeledHUsd: state.hUsd, excludedProfitUsd: state.excludedProfitUsd, baseUsd: state.baseUsd, cycleCeilingUsd: currentCeiling,
    freshProfitUsd: g, triggerReached: activeCycle, wouldRequestReview: trigger.wouldRequestReview, triggerAmountUsd: trigger.threshold, caps, reserveUsd: r, assessedProfitUsd: G,
    retainedActiveUsd: retained, roundingResidualUsd: residual, cashShortfallUsd: shortfall, operatingRequirement: floor,
    inputHash: capitalHash(inputs), inputsJson: canonicalJson(inputs as unknown as CanonicalJsonValue), evidenceRefs: f.evidenceRefs });
}

export function applyEconomicCashReview(policy: ReservePolicy, state: ReserveState, preview: ReservePreview, operationKey: string, atMs: number): { state: ReserveState; assessment: ReserveAssessment } {
  if (state.domain !== 'preview' || identifiedBudgetFact(preview).id !== preview.id || preview.state !== 'eligible' || preview.stateId !== state.id || preview.policyId !== policy.id || atMs >= preview.expiresAtMs || atMs < preview.evaluatedAtMs ||
    evaluateEconomicCashReview(policy, state, preview.financial, preview.operatingRequirement, preview.evaluatedAtMs).id !== preview.id ||
    preview.reserveUsd.state !== 'available' || preview.assessedProfitUsd.state !== 'available' || preview.roundingResidualUsd.state !== 'available' || !amount(preview.reserveUsd.value).gt(0)) throw new Error('reserve_preview_invalid');
  const h = amount(state.hUsd).add(preview.assessedProfitUsd.value), reserved = amount(state.reservedUsd).add(preview.reserveUsd.value);
  const ceiling = preview.cycleCeilingUsd!;
  const remaining = D.max(0, amount(ceiling).sub(h));
  const close = remaining.mul(policy.settings.shareBps).div(10_000).toDecimalPlaces(2, D.ROUND_FLOOR).lt(policy.settings.minimumBatchUsd);
  const taxAddition = D.max(0, amount(policy.settings.taxHold.amountUsd).sub(state.taxHoldUsd));
  const next = identifiedBudgetFact({ ...state, previousId: state.id, operationKey, atMs, event: 'assessment' as const, hUsd: text(h), reservedUsd: text(reserved),
    allocatedUsd: text(amount(state.allocatedUsd).add(preview.reserveUsd.value)),
    taxHoldUsd: text(amount(state.taxHoldUsd).add(taxAddition)), profitBackedTaxUsd: text(amount(state.profitBackedTaxUsd).add(policy.settings.taxHold.backing === 'profit' ? taxAddition : 0)),
    cycle: close ? null : state.cycle ?? { id: capitalHash({ stateId: state.id, ceiling }), ceilingUsd: ceiling },
    balanceConsumed: state.balanceConsumed || close && policy.settings.trigger.kind === 'balance_usd',
    baseUsd: close && preview.retainedActiveUsd.state === 'available' ? preview.retainedActiveUsd.value : state.baseUsd,
    baseProfitUsd: close && preview.financial.economicPnlUsd.state === 'available' ? preview.financial.economicPnlUsd.value : state.baseProfitUsd,
    evidenceRefs: [...preview.evidenceRefs, preview.id, ...(close && remaining.gt(0) ? ['small_deferred_remainder'] : [])] });
  return { state: next, assessment: identifiedBudgetFact({ domain: 'preview' as const, scopeId: state.scopeId, streamId: state.streamId, operationKey, policyId: policy.id,
    beforeId: state.id, afterId: next.id, previewId: preview.id, hBeforeUsd: state.hUsd, hAfterUsd: next.hUsd, assessedProfitUsd: preview.assessedProfitUsd.value,
    reserveUsd: preview.reserveUsd.value, shareBps: policy.settings.shareBps, roundingResidualUsd: preview.roundingResidualUsd.value,
    budgetRevision: preview.financial.budgetRevision, inputHash: preview.inputHash }) };
}

export function reviewContestEconomicCash(book:ReplayBook,spec:CapitalReplaySpecV1,v:ReplayVariant,frame:ReplayMarketFrame,marks:Readonly<Record<string,string>>,
  pending:readonly ReplayPendingOrder[],usedTurnover:string,intents:readonly FeasibilityIntentV1[],policy:ReservePolicy,state:ReserveState|null){
  const cut=replayReserveFinancial(book,spec,v,frame,marks,pending,usedTurnover,intents);
  let current=state;
  if(current===null||current.baseline==='awaiting_evidence')current=reserveBaseline(policy,current,cut.financial,capitalHash({scope:book.scopeId,event:'baseline',at:frame.atMs}),frame.atMs);
  current=openReserveCycle(policy,current,cut.financial,capitalHash({scope:book.scopeId,event:'cycle',at:frame.atMs}),frame.atMs);
  const floor=reserveCapitalWitness(cut.frame,v.operatingObjective),preview=evaluateEconomicCashReview(policy,current,cut.financial,floor,frame.atMs);
  if(preview.state!=='eligible')return {state:current,preview,assessment:null};
  const applied=applyEconomicCashReview(policy,current,preview,capitalHash({scope:book.scopeId,event:'assess',at:frame.atMs,state:current.id}),frame.atMs);
  return {state:applied.state,preview,assessment:applied.assessment};
}
