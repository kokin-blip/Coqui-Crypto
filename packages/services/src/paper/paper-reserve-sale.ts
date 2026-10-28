import { capitalHash, sha256Hex, decimal, instrumentKey, modeledFill, DEFAULT_TRADE_COST_CONFIG, preparePaperReserveSale, budgetAmount as a, BudgetDecimal as D, evaluatePaperReserve, unavailableReserveCapital,
  type AssetRef, type PaperReservePolicy, type PaperReserveState, type PaperReserveSaleInput, type PaperReserveSaleConsequence } from '@coqui/core';
import { appendPaperExecutionEvent, appendPaperReserveEvent, getPaperExecutionProposal, savePaperExecutionProposal, getPaperExecutionPolicy, inTransaction,
  paperProposalPurpose, paperReserveCommand, savePaperReserveCommand, readPaperReserveFact, listSubmittedPaperExecutions, currentBudget, type Db } from '@coqui/storage';
import { activePaperCapitalBinding, readPaperCapitalEvidence } from '../portfolio/paper-capital-evidence.js';
import type { PaperReserveAuthorityPort } from '../portfolio/paper-profit-reserve.js';
import type { PaperExecutionService, ProposedPaperAction } from './execution-service.js';
import { paperCostModelHash } from './venue.js';

export interface SaleReceipt { readonly input: PaperReserveSaleInput; readonly consequence: PaperReserveSaleConsequence; readonly proposalId: string; readonly runId: string; readonly review?:PaperReserveSaleReview }
export interface PaperReserveSaleReview {
  readonly consequenceId: string; readonly objectiveHash: string; readonly cashCapabilityReviewRef: string; readonly policyEvidenceReviewRef: string;
}
/** Main-owned financial/model and review ports. No renderer evidence, adapter, transfer or scheduler port. */
export interface PaperReserveSaleModel {
  current(atMs:number): PaperReserveSaleInput;
  asset(assetId: string): AssetRef;
  pending(consequence: PaperReserveSaleConsequence, runId: string): NonNullable<ProposedPaperAction['pending']>;
  reviewed(consequenceId: string): PaperReserveSaleReview | null;
}
/** Disabled by construction unless an existing authorized P6 book and exact review are supplied.
 * Preparation creates a human-reviewed OMS proposal only. It never commits a reserve.
 */
export function createPaperReserveSaleService(c: { profileId: string; database: Db; now: () => number; authority: PaperReserveAuthorityPort;
  model: PaperReserveSaleModel; execution: (guard: (proposalId: string) => boolean) => PaperExecutionService;
  reassess: () => unknown }) {
  const db = c.database, drafts = new Map<string, { input: PaperReserveSaleInput; consequence: PaperReserveSaleConsequence }>();
  const context = () => {
    const { book, binding } = activePaperCapitalBinding(c.profileId, db);
    const policy = binding.policy_id ? readPaperReserveFact<PaperReservePolicy>('policy', binding.policy_id, db) : null;
    const state = binding.state_id ? readPaperReserveFact<PaperReserveState>('state', binding.state_id, db) : null;
    if (!policy || !state) throw new Error('sale_policy_missing');
    return { book, binding, policy, state };
  };
  const current = () => {
    const atMs=c.now(),ctx = context(), input = c.model.current(atMs), f = readPaperCapitalEvidence(c.profileId, atMs, db).financial;
    const { objective: o, frame } = input;
    const budget = currentBudget(ctx.binding.scope_id, atMs, db);
    if (!budget || capitalHash(budget) !== capitalHash(frame.budget) || frame.nowMs !== atMs || input.policyId !== ctx.policy.id || input.stateId !== ctx.state.id || frame.budget.scopeId !== ctx.binding.scope_id ||
        f.budgetRevision !== frame.budget.revision || f.reasonCodes.length || f.assurance !== 'observed' || atMs >= f.expiresAtMs ||
        f.actualPendingUsd.state !== 'available' || a(f.actualPendingUsd.value).gt(0) || listSubmittedPaperExecutions(c.profileId, db).length) throw new Error('sale_financial_cut_unavailable');
    const p = f.economicPnlUsd, r = f.realizedPnlUsd, prior = f.priorProfitBackedUsd;
    if (p.state !== 'available' || r.state !== 'available' || prior.state !== 'available') throw new Error('sale_profit_evidence_unavailable');
    // Reuse the exact operational trigger/cycle; unavailable operating evidence is never fabricated.
    const probe = evaluatePaperReserve(ctx.policy, ctx.state, f, unavailableReserveCapital(f.scopeId, f.budgetRevision, f.expiresAtMs, 'sale_post_fill_reassessment_required'), atMs);
    const tax = D.max(0, a(ctx.policy.settings.taxHold.amountUsd).sub(ctx.state.taxHoldUsd));
    const deferredFloorReasons = new Set(['sale_post_fill_reassessment_required','operating_requirement_binding_missing','milestone_not_reached','below_reserve_batch']);
    if (probe.reasonCodes.some(code => !deferredFloorReasons.has(code)) || a(o.reserveUsd).lt(ctx.policy.settings.minimumBatchUsd) ||
        probe.cycleCeilingUsd === null || !a(o.economicBackingUsd).eq(a(p.value).sub(prior.value)) || !a(o.realizedBackingUsd).eq(a(r.value).sub(prior.value)) ||
        !a(o.freshProfitUsd).eq(D.max(0, D.min(p.value, probe.cycleCeilingUsd).sub(ctx.state.hUsd))) || o.shareBps !== ctx.policy.settings.shareBps ||
        !a(o.additionalTaxUsd).eq(tax) || !a(o.profitBackedTaxUsd).eq(ctx.policy.settings.taxHold.backing === 'profit' ? tax : 0) ||
        tax.gt(0) && ctx.policy.settings.taxHold.backing === 'unknown' || a(o.retainedFloorUsd).lt(ctx.policy.settings.retainedCapitalUsd)) throw new Error('sale_objective_financial_binding_invalid');
    return { ...ctx, input };
  };
  // A read clock is not a new financial cut. Every economic field, source, claim and
  // observation timestamp still participates; native/fee expiry is checked separately.
  const sameCut = (old: PaperReserveSaleInput, fresh: PaperReserveSaleInput) => capitalHash(old) === capitalHash({ ...fresh, frame: { ...fresh.frame, nowMs: old.frame.nowMs,
    budget: { ...fresh.frame.budget, id: old.frame.budget.id, evaluatedAtMs: old.frame.budget.evaluatedAtMs } } });
  const reviewed = (consequence: PaperReserveSaleConsequence) => {
    const approval = c.model.reviewed(consequence.id);
    if (!approval || approval.consequenceId !== consequence.id || approval.objectiveHash !== capitalHash(consequence.objective) ||
        !approval.cashCapabilityReviewRef || !approval.policyEvidenceReviewRef) throw new Error('sale_explicit_objective_review_required');
    return approval;
  };
  const executionCostSupported = (input: PaperReserveSaleInput, consequence: PaperReserveSaleConsequence) => {
    const selected = consequence.candidates.find(x => x.assetId === consequence.selectedAssetId), mark = input.frame.assets.find(x => x.assetId === selected?.assetId)?.markUsd;
    if (!selected?.quantity || !mark || !selected.costUsd || !selected.netProceedsUsd) return false;
    const fill = modeledFill('sell', selected.quantity, mark, DEFAULT_TRADE_COST_CONFIG), reference = a(selected.quantity).mul(mark);
    // The OMS prices a fixed reference-notional intent and rounds its costs. A P2
    // affine scenario must conservatively bound that actual simulator convention.
    return a(selected.costUsd).gte(fill.totalCost) && a(selected.netProceedsUsd).lte(fill.cashChange) &&
      reference.lte(input.objective.maxNotionalUsd) && reference.lte(input.objective.maxExposureReductionUsd);
  };
  const guard = (proposalId: string): boolean => {
    try {
      const ctx = current(), purpose = paperProposalPurpose(proposalId, c.profileId, db);
      if (ctx.binding.disabled || purpose?.purpose !== 'profit_reserve_sale') return false;
      c.authority.check(ctx.policy.id, ctx.binding.generation);
      const receipt = paperReserveCommand<SaleReceipt>(ctx.binding.scope_id, purpose.commandId, purpose.requestHash, db);
      if (!receipt || receipt.proposalId !== proposalId || c.now() >= receipt.consequence.expiresAtMs || !sameCut(receipt.input, ctx.input)) return false;
      const checked = preparePaperReserveSale(ctx.input);
      const economics = (p: PaperReserveSaleConsequence) => p.candidates.map(row => ({ ...row, feasibilityId: null }));
      if (checked.state !== 'modeled' || checked.selectedAssetId !== receipt.consequence.selectedAssetId ||
          capitalHash(economics(checked)) !== capitalHash(economics(receipt.consequence))) return false;
      reviewed(receipt.consequence); return executionCostSupported(ctx.input, receipt.consequence);
    } catch { return false; }
  };
  return {
    orderPreview(proposalId:string){
      if(paperProposalPurpose(proposalId,c.profileId,db)?.purpose!=='profit_reserve_sale')throw new Error('sale_proposal_not_found');
      return c.execution(guard).preview(proposalId);
    },
    preview() {
      const { input } = current(), consequence = preparePaperReserveSale(input);
      if (drafts.size >= 100) drafts.delete(drafts.keys().next().value!);
      drafts.set(consequence.id, { input, consequence }); return consequence;
    },
    prepare(r: { readonly commandId: string; readonly consequenceId: string }) {
      if (!/^[a-f0-9-]{36}$/iu.test(r.commandId)) throw new Error('sale_command_id_invalid');
      return inTransaction(db, () => {
        const ctx = context(), requestHash = capitalHash({ profileId: c.profileId, purpose: 'profit_reserve_sale', request: r });
        const retry = paperReserveCommand<SaleReceipt>(ctx.binding.scope_id, r.commandId, requestHash, db);
        if (retry) return retry;
        const fresh = current(), draft = drafts.get(r.consequenceId);
        if (fresh.binding.disabled) throw new Error('sale_manual_authorization_required');
        c.authority.check(fresh.policy.id, fresh.binding.generation);
        if (!draft || draft.consequence.state !== 'modeled' || c.now() >= draft.consequence.expiresAtMs || !sameCut(draft.input, fresh.input)) throw new Error('sale_consequence_stale_or_unavailable');
        const approval=reviewed(draft.consequence);
        if (!executionCostSupported(fresh.input, draft.consequence)) throw new Error('sale_execution_cost_consequence_unsupported');
        if (getPaperExecutionPolicy(c.profileId, db).mode !== 'review_required') throw new Error('sale_separate_order_review_required');
        const selected = draft.consequence.candidates.find(x => x.assetId === draft.consequence.selectedAssetId)!;
        const asset = c.model.asset(selected.assetId), mark = draft.input.frame.assets.find(x => x.assetId === selected.assetId)!.markUsd;
        if (instrumentKey(asset.instrument) !== selected.assetId) throw new Error('sale_asset_identity_mismatch');
        const runId = capitalHash({ scopeId: ctx.binding.scope_id, sale: draft.consequence.id }), proposalId = capitalHash({ runId, purpose: 'profit_reserve_sale' });
        const priorProposal = getPaperExecutionProposal(proposalId, db);
        if (priorProposal && priorProposal.status !== 'pending_review') throw new Error('sale_proposal_review_closed');
        const pending = c.model.pending(draft.consequence, runId);
        if (pending.costModelHash !== paperCostModelHash()) throw new Error('sale_execution_cost_identity_mismatch');
        const receipt: SaleReceipt = { input: draft.input, consequence: draft.consequence, proposalId, runId, review:approval };
        const intents = [{ asset, side: 'sell' as const, amountUsd: decimal(a(selected.quantity!).mul(mark).toFixed()),
          referencePriceUsd: decimal(mark), origin: 'rebalance' as const, urgency: 'standard' as const }];
        const intentsJson = JSON.stringify(intents), proposalHash = sha256Hex(`${c.profileId}:${runId}:1:${intentsJson}`);
        savePaperExecutionProposal({ id: proposalId, profileId: c.profileId, runId, revision: 1, proposalHash, intentsJson, status: 'pending_review', createdAt: c.now(), updatedAt: c.now() }, db);
        savePaperReserveCommand(ctx.binding.scope_id, r.commandId, requestHash, receipt, db);
        appendPaperExecutionEvent(proposalId, c.profileId, 'prepared', c.now(), { purpose: 'profit_reserve_sale', commandId: r.commandId, requestHash, requireHumanReview: true }, db);
        const result = c.execution(guard).prepare({ proposalId, runId, revision: 1, requireHumanReview: true, pending, intents });
        if (result.status !== 'pending' || getPaperExecutionProposal(proposalId, db)?.profileId !== c.profileId) throw new Error('sale_existing_execution_gates_refused');
        appendPaperReserveEvent(ctx.binding.scope_id, { operationKey: r.commandId, kind: 'sale_prepared_no_reserve_funding', atMs: c.now(), refs: [proposalId, draft.consequence.id] }, db);
        return receipt;
      });
    },
    review(r: Parameters<PaperExecutionService['review']>[0]) {
      if (paperProposalPurpose(r.proposalId, c.profileId, db)?.purpose !== 'profit_reserve_sale') throw new Error('sale_proposal_not_found');
      // The sole execution service preserves cached unknown/acknowledged outcomes before
      // invoking the purpose guard for any new submission. No blind retry is introduced.
      return c.execution(guard).review(r);
    },
    reconcile(proposalId: string) {
      const ctx = context(), purpose = paperProposalPurpose(proposalId, c.profileId, db);
      if (purpose?.purpose !== 'profit_reserve_sale') throw new Error('sale_proposal_not_found');
      const receipt = paperReserveCommand<SaleReceipt>(ctx.binding.scope_id, purpose.commandId, purpose.requestHash, db);
      if (!receipt || receipt.proposalId !== proposalId) throw new Error('sale_proposal_not_found');
      const pending = listSubmittedPaperExecutions(c.profileId, db).length > 0;
      const proposal = getPaperExecutionProposal(proposalId, db);
      const orders = db.prepare('SELECT state status FROM paper_orders_v3 WHERE profile_id=? AND run_id=?').all(c.profileId, receipt.runId) as { status: string }[];
      if (pending || !proposal || proposal.status === 'unknown' || orders.some(x => !['filled','cancelled','expired','risk_rejected','reconciled'].includes(x.status)) ||
          !orders.length && !['rejected','blocked','failed'].includes(proposal.status)) return { status: 'settlement_unresolved' as const, reserveFunded: false as const };
      // Actual P6 evidence/requirements are reread. This returns a proposal, never commits it.
      return { status: 'reassessed' as const, proposal: c.reassess(), reserveFunded: false as const };
    },
  };
}
