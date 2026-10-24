import { BudgetDecimal as D, budgetAmount as amount, budgetText as text, identifiedBudgetFact } from '../execution/native-rules.js';
import { capitalHash } from './capital-ledger.js';
import { evaluateProfitReserve, reserveTrigger, type ReservePolicy, type ReserveState, type ReserveFinancialInput, type ReservePreview } from './profit-reserve.js';

export function reserveBaseline(policy: ReservePolicy, prior: ReserveState | null, f: ReserveFinancialInput, operationKey: string, atMs: number): ReserveState {
  if (prior && f.reasonCodes.includes('funded_operation_unresolved')) throw new Error('reserve_pending_operation_unresolved');
  if (policy.scopeId !== f.scopeId || prior && (prior.domain !== 'preview' || prior.scopeId !== f.scopeId || amount(prior.pendingUsd).gt(0))) throw new Error('reserve_pending_or_scope_conflict');
  const ready = f.economicPnlUsd.state === 'available' && f.activeEquityUsd.state === 'available' && !f.reasonCodes.length && atMs < f.expiresAtMs;
  const beforeH = amount(prior?.hUsd ?? '0'), h = ready && f.economicPnlUsd.state === 'available' ? D.max(beforeH, f.economicPnlUsd.value, 0) : beforeH;
  return identifiedBudgetFact({ domain: 'preview' as const, scopeId: policy.scopeId, streamId: prior?.streamId ?? capitalHash({ scopeId: policy.scopeId, originProfileId: policy.originProfileId, domain: 'preview' }),
    policyId: policy.id, previousId: prior?.id ?? null, operationKey, atMs, event: 'baseline' as const,
    baseline: ready ? 'ready' as const : 'awaiting_evidence' as const, hUsd: text(h), excludedProfitUsd: text(h.sub(beforeH)),
    baseUsd: ready && f.activeEquityUsd.state === 'available' ? f.activeEquityUsd.value : null,
    baseProfitUsd: ready && f.economicPnlUsd.state === 'available' ? f.economicPnlUsd.value : null,
    cycle: null, balanceConsumed: false, allocatedUsd: prior?.allocatedUsd ?? '0', reservedUsd: prior?.reservedUsd ?? '0',
    taxHoldUsd: prior?.taxHoldUsd ?? '0', profitBackedTaxUsd: prior?.profitBackedTaxUsd ?? '0', pendingUsd: prior?.pendingUsd ?? '0', evidenceRefs: f.evidenceRefs });
}
export function openReserveCycle(policy: ReservePolicy, state: ReserveState, f: ReserveFinancialInput, operationKey: string, atMs: number): ReserveState {
  if (state.domain !== 'preview' || state.policyId !== policy.id || state.scopeId !== f.scopeId) throw new Error('reserve_state_identity');
  if (amount(state.pendingUsd).gt(0) || state.cycle || !reserveTrigger(policy, state, f).reached || f.economicPnlUsd.state !== 'available' || f.reasonCodes.length || atMs >= f.expiresAtMs || policy.settings.goal !== 'preview' || policy.settings.shareBps === 0) return state;
  const ceilingUsd = amount(f.economicPnlUsd.value).toDecimalPlaces(2, D.ROUND_FLOOR).toFixed();
  return identifiedBudgetFact({ ...state, previousId: state.id, operationKey, atMs, event: 'cycle_open' as const,
    cycle: { id: capitalHash({ streamId: state.streamId, stateId: state.id, ceilingUsd }), ceilingUsd }, evidenceRefs: f.evidenceRefs });
}
export interface ReserveAssessment {
  readonly id: string; readonly domain: 'preview'; readonly scopeId: string; readonly streamId: string; readonly operationKey: string;
  readonly policyId: string; readonly beforeId: string; readonly afterId: string; readonly previewId: string;
  readonly hBeforeUsd: string; readonly hAfterUsd: string; readonly assessedProfitUsd: string; readonly reserveUsd: string;
  readonly shareBps: number; readonly roundingResidualUsd: string; readonly budgetRevision: string | null; readonly inputHash: string;
}
/** Only an isolated modeled book changes. Actual account claims are not accepted by this reducer. */
export function applyModeledReserve(policy: ReservePolicy, state: ReserveState, preview: ReservePreview, operationKey: string, atMs: number): { state: ReserveState; assessment: ReserveAssessment } {
  if (state.domain !== 'preview' || identifiedBudgetFact(preview).id !== preview.id || preview.state !== 'eligible' || preview.stateId !== state.id || preview.policyId !== policy.id || atMs >= preview.expiresAtMs || atMs < preview.evaluatedAtMs ||
    evaluateProfitReserve(policy, state, preview.financial, preview.operatingRequirement, preview.evaluatedAtMs).id !== preview.id ||
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
export function releaseModeledReserve(state: ReserveState, dollars: string, operationKey: string, atMs: number): ReserveState {
  if (state.domain !== 'preview' || amount(dollars).lte(0) || amount(dollars).gt(state.reservedUsd) || amount(dollars).decimalPlaces() > 2 || amount(state.pendingUsd).gt(0)) throw new Error('reserve_release_invalid');
  return identifiedBudgetFact({ ...state, previousId: state.id, operationKey, atMs, event: 'release' as const, reservedUsd: text(amount(state.reservedUsd).sub(dollars)) });
}
export function cancelReserveCycle(state: ReserveState, operationKey: string, atMs: number): ReserveState {
  if (state.domain !== 'preview' || amount(state.pendingUsd).gt(0)) throw new Error('reserve_pending_operation_unresolved');
  return identifiedBudgetFact({ ...state, previousId: state.id, operationKey, atMs, event: 'cancel' as const, cycle: null });
}
