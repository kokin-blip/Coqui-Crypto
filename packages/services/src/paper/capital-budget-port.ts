import { budgetAmount, budgetClaimHeads, budgetText, capitalHash, cashClaim, instrumentKey,
  modeledFill, DEFAULT_TRADE_COST_CONFIG, projectAccountBudget, type BudgetReportV1, type InstrumentIdentity } from '@coqui/core';
import { advanceLocalBudgetSource, currentBudget, getBudgetSource, getCapitalScope, getPaperBookOrigin, getPaperCapitalBook, paperReserveBinding, getPaperOrder,
  inTransaction, listCapitalBindings, listCashClaims, saveCashClaim, withBudgetClaim, type Db } from '@coqui/storage';
import { capturePaperCapitalEvidence, readPaperCapitalEvidence } from '../portfolio/paper-capital-evidence.js';
import { localCapitalBudgetEvidence, recordBudgetDeficit } from '../portfolio/capital-budget-sources.js';

export interface PaperBudgetIntent {
  readonly profileId: string; readonly campaignId: string | null; readonly orderId: string;
  readonly instrument: InstrumentIdentity; readonly side: 'buy' | 'sell'; readonly requestedUsd: string;
  readonly expectedRevision: string; readonly pending: boolean; readonly actualDebitUsd?: string; readonly quantity?: string;
}
/** Explicitly injected into a new isolated version only; no default or connected implementation. */
export interface PaperCapitalBudgetPort {
  budget(): BudgetReportV1;
  capacity(context: { profileId: string; campaignId: string | null }, side: 'buy' | 'sell', instrument: InstrumentIdentity,
    priceUsd: string, orderId: string): { availableUsd: string; revision: string };
  withIntent<T>(intent: PaperBudgetIntent, persistExistingIntent: () => T): T;
  releaseTerminal(orderId: string): void;
}
const paperCapitalPorts=new WeakMap<PaperCapitalBudgetPort,{profileId:string;scopeId:string}>();
export function assertPaperCapitalBudgetCoverage(profileId:string,port:PaperCapitalBudgetPort|undefined,db:Db):void {
  const b=paperReserveBinding(profileId,db);if(!getPaperCapitalBook(profileId,db) && !b)return;
  const proof=port?paperCapitalPorts.get(port):null;if(!b || b.archived || !proof || proof.profileId!==profileId || proof.scopeId!==b.scope_id)throw new Error('paper_capital_budget_port_required');
}
export function createPaperCapitalBudgetPort(input: { profileId: string; scopeId: string; database: Db;
  now: () => number; guardAuthority: () => boolean; version?: 'paper-reserve-cash-v1'; marks?: () => Readonly<Record<string,{priceUsd:string;atMs:number;ref:string}>> }): PaperCapitalBudgetPort {
  const { profileId, scopeId, database: db } = input;
  const guard = () => {
    if(input.version==='paper-reserve-cash-v1'){const book=getPaperCapitalBook(profileId,db),binding=paperReserveBinding(profileId,db);
      if(!book || !binding || binding.archived || binding.scope_id!==scopeId || binding.book_id!==book.id || !input.guardAuthority())throw new Error('budget_authority_unavailable');return;
    }
    if(getPaperCapitalBook(profileId,db))throw new Error('paper_capital_budget_port_required');
    const scope = getCapitalScope(scopeId, db), origin = getPaperBookOrigin(profileId, db);
    if (!input.guardAuthority() || !origin || origin.snapshot.profileId !== profileId || scope?.originProfileId !== profileId ||
      scope.provider !== 'local_paper' || scope.environment !== 'simulation' ||
      scope.accountIdentityHash !== capitalHash({ profileId, originHash: origin.contentHash }) ||
      !listCapitalBindings(profileId, db).some(row => row.scopeId === scopeId && row.mode === 'active')) throw new Error('budget_authority_unavailable');
  };
  const observe = (): BudgetReportV1 => {
    guard();
    if(input.version==='paper-reserve-cash-v1'){
      if(!input.marks)throw new Error('paper_capital_marks_required');
      const read=readPaperCapitalEvidence(profileId,input.now(),db);
      if(read.financial.reasonCodes.includes('paper_reserve_source_stale') || input.now()>=read.source.expiresAtMs)capturePaperCapitalEvidence(profileId,input.now(),input.marks(),db);
      const report=currentBudget(scopeId,input.now(),db)!;recordBudgetDeficit(report,db,profileId);
      if(readPaperCapitalEvidence(profileId,input.now(),db).financial.reasonCodes.length)throw new Error('paper_capital_reconciliation_required');return report;
    }
    const previous = currentBudget(scopeId, input.now(), db), fresh = localCapitalBudgetEvidence(profileId, input.now(), db, true);
    if (!previous || !fresh || fresh.scopeId !== scopeId) throw new Error('budget_source_missing');
    const source = getBudgetSource(previous.sourceId, db)!;
    const content = (row: typeof source) => capitalHash({ cash: row.cashUsd, equity: row.equityUsd, positions: row.positions,
      refs: row.evidenceRefs, complete: row.complete, holds: row.holdMatchingComplete, authority: row.authority });
    if (content(source) !== content(fresh) || input.now() >= source.expiresAtMs) advanceLocalBudgetSource(fresh, source.id, db);
    const report = currentBudget(scopeId, input.now(), db)!; recordBudgetDeficit(report, db, profileId); return report;
  };
  const releaseTerminal = (orderId: string) => {
    guard();
    const order = getPaperOrder(orderId, db);
    if (!order || order.profileId !== profileId || !['filled', 'expired', 'cancelled', 'venue_rejected', 'risk_rejected'].includes(order.state)) throw new Error('budget_order_not_terminal');
    const head = budgetClaimHeads(listCashClaims(scopeId, db)).heads.find(row => row.originKey === `paper-order:${orderId}`);
    if (head && !['settled', 'released'].includes(head.state)) saveCashClaim(cashClaim({ ...head, replacesId: head.id,
      state: order.state === 'filled' ? 'settled' : 'released', evidenceRefs: [...head.evidenceRefs, `paper-terminal:${orderId}:${order.state}`] }), db);
  };
  const port:PaperCapitalBudgetPort = {
    budget: observe,
    capacity(context, side, instrument, priceUsd, orderId) {
      if (context.profileId !== profileId || context.campaignId !== null) throw new Error('budget_book_mismatch');
      const current = observe(), claims = listCashClaims(scopeId, db);
      const own = budgetClaimHeads(claims).heads.find(row => row.originKey === `paper-order:${orderId}`);
      // A pending order may use its own commitment exactly once at settlement.
      const usable = own ? projectAccountBudget(getBudgetSource(current.sourceId, db)!, claims.filter(row => row.originKey !== own.originKey), input.now()) : current;
      if (!usable.executionEligible) throw new Error('capital_budget_unavailable');
      return { revision: current.revision, availableUsd: side === 'buy' ? usable.spendableUsd! :
        budgetText(budgetAmount(usable.quantities[instrumentKey(instrument)] ?? '0').mul(priceUsd)) };
    },
    withIntent(intent, persistExistingIntent) {
      return inTransaction(db, () => {
        if (intent.profileId !== profileId || intent.campaignId !== null) throw new Error('budget_book_mismatch');
        const current = observe();
        if (current.revision !== intent.expectedRevision) throw new Error('budget_revision_stale');
        const prior = budgetClaimHeads(listCashClaims(scopeId, db)).heads.find(row => row.originKey === `paper-order:${intent.orderId}`);
        if (prior && ['released', 'settled'].includes(prior.state)) throw new Error('budget_order_already_terminal');
        // The legacy simulator models fees in USD; the reference-notional bound includes its fixed cost model.
        const amount = intent.side === 'buy' ? intent.actualDebitUsd ?? budgetAmount(modeledFill('buy', intent.requestedUsd, '1', DEFAULT_TRADE_COST_CONFIG).cashChange).neg().toFixed() :
          intent.quantity ?? current.quantities[instrumentKey(intent.instrument)] ?? '0';
        if (prior && !intent.pending && budgetAmount(amount).gt(prior.amount)) throw new Error('budget_pending_bound_exceeded');
        const claim = prior && prior.amount === amount ? prior : cashClaim({ scopeId, originKey: `paper-order:${intent.orderId}`, replacesId: prior?.id ?? null,
          assetId: intent.side === 'buy' ? 'USD' : instrumentKey(intent.instrument), amount, purpose: 'order', state: 'committed',
          reflectedIn: [], reflectionEvidence: [], evidenceRefs: [current.sourceId, `paper-intent:${intent.orderId}`] });
        return withBudgetClaim(profileId, scopeId, current.revision, claim, input.now(), db, () => {
          const result = persistExistingIntent();
          if (!intent.pending) releaseTerminal(intent.orderId);
          observe();
          return result;
        });
      });
    },
    releaseTerminal,
  };
  if(input.version==='paper-reserve-cash-v1')paperCapitalPorts.set(port,{profileId,scopeId});return port;
}
export function paperBudgetTransaction<T>(port: PaperCapitalBudgetPort | undefined, intent: PaperBudgetIntent | null,
  database: Db, operation: () => T): T {
  return port && intent ? port.withIntent(intent, operation) : inTransaction(database, operation);
}
