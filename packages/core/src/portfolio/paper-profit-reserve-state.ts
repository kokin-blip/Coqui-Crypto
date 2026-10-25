import { BudgetDecimal as D, budgetAmount as a, budgetText as t, identifiedBudgetFact } from '../execution/native-rules.js';
import { capitalHash } from './capital-ledger.js';
import type { ReserveFinancialInput } from './profit-reserve.js';
import { PAPER_RESERVE_VERSION, type PaperReservePolicy, type PaperReserveState, type PaperReserveProposal } from './paper-profit-reserve-types.js';
import { evaluatePaperReserve } from './paper-profit-reserve.js';
export function paperReserveBaseline(policy: PaperReservePolicy, prior: PaperReserveState | null, f: ReserveFinancialInput, operationKey: string, atMs: number): PaperReserveState {
  if (policy.scopeId !== f.scopeId || prior && (prior.scopeId !== f.scopeId || prior.domain !== PAPER_RESERVE_VERSION || a(prior.pendingUsd).gt(0)) || f.economicPnlUsd.state !== 'available' || f.activeEquityUsd.state !== 'available' || f.reasonCodes.length || atMs >= f.expiresAtMs || f.assurance !== 'observed' || f.actualPendingUsd.state!=='available' || a(f.actualPendingUsd.value).gt(0)) throw new Error('paper_reserve_baseline_unavailable');
  const before = a(prior?.hUsd ?? '0'), h = D.max(before, f.economicPnlUsd.value, 0);
  return identifiedBudgetFact({ domain: PAPER_RESERVE_VERSION, scopeId: policy.scopeId, streamId: prior?.streamId ?? capitalHash({ version: PAPER_RESERVE_VERSION, scopeId: policy.scopeId }),
    policyId: policy.id, previousId: prior?.id ?? null, operationKey, atMs, event: 'baseline' as const, hUsd: t(h), excludedProfitUsd: t(h.sub(before)),
    baseUsd: f.activeEquityUsd.value, baseProfitUsd: f.economicPnlUsd.value, cycle: null, balanceConsumed: false,
    allocatedUsd: prior?.allocatedUsd ?? '0', reservedUsd: prior?.reservedUsd ?? '0', taxHoldUsd: prior?.taxHoldUsd ?? '0', profitBackedTaxUsd: prior?.profitBackedTaxUsd ?? '0', pendingUsd: prior?.pendingUsd ?? '0', evidenceRefs: f.evidenceRefs });
}
export function applyPaperReserve(policy: PaperReservePolicy, state: PaperReserveState, proposal: PaperReserveProposal, operationKey: string, atMs: number): PaperReserveState {
  if (proposal.state !== 'eligible' || proposal.stateId !== state.id || atMs < proposal.evaluatedAtMs || atMs >= proposal.expiresAtMs ||
    evaluatePaperReserve(policy, state, proposal.financial, proposal.operatingRequirement, proposal.evaluatedAtMs).id !== proposal.id ||
    proposal.reserveUsd.state !== 'available' || proposal.assessedProfitUsd.state !== 'available' || proposal.retainedActiveUsd.state !== 'available' || !a(proposal.reserveUsd.value).gt(0) || !proposal.cycleCeilingUsd) throw new Error('paper_reserve_proposal_invalid');
  const h = a(state.hUsd).add(proposal.assessedProfitUsd.value), remaining = D.max(0, a(proposal.cycleCeilingUsd).sub(h));
  const close = remaining.mul(policy.settings.shareBps).div(10_000).toDecimalPlaces(2, D.ROUND_FLOOR).lt(policy.settings.minimumBatchUsd);
  return identifiedBudgetFact({ ...state, previousId: state.id, operationKey, atMs, event: 'assessment' as const, hUsd: t(h),
    allocatedUsd: t(a(state.allocatedUsd).add(proposal.reserveUsd.value)), reservedUsd: t(a(state.reservedUsd).add(proposal.reserveUsd.value)),
    taxHoldUsd: t(a(state.taxHoldUsd).add(proposal.additionalTaxUsd)), profitBackedTaxUsd: t(a(state.profitBackedTaxUsd).add(policy.settings.taxHold.backing === 'profit' ? proposal.additionalTaxUsd : 0)),
    cycle: close ? null : state.cycle ?? { id: capitalHash({ stateId: state.id, ceiling: proposal.cycleCeilingUsd }), ceilingUsd: proposal.cycleCeilingUsd },
    balanceConsumed: state.balanceConsumed || close && policy.settings.trigger.kind === 'balance_usd',
    baseUsd: close ? proposal.retainedActiveUsd.value : state.baseUsd, baseProfitUsd: close && proposal.financial.economicPnlUsd.state === 'available' ? proposal.financial.economicPnlUsd.value : state.baseProfitUsd,
    evidenceRefs: [...proposal.financial.evidenceRefs, proposal.id] });
}
export function releasePaperReserve(state: PaperReserveState, purpose: 'profit_reserve' | 'tax_hold', dollars: string, operationKey: string, atMs: number): PaperReserveState {
  const field = purpose === 'profit_reserve' ? 'reservedUsd' : 'taxHoldUsd';
  if (state.domain !== PAPER_RESERVE_VERSION || a(dollars).lte(0) || a(dollars).decimalPlaces() > 2 || a(dollars).gt(state[field]) || a(state.pendingUsd).gt(0)) throw new Error('paper_reserve_release_invalid');
  return identifiedBudgetFact({ ...state, previousId: state.id, operationKey, atMs, event: 'release' as const, [field]: t(a(state[field]).sub(dollars)) });
}
