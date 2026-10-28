import {budgetAmount as a,budgetText as t,BudgetDecimal as D,capitalHash,evaluatePaperReserve,unavailableReserveCapital,type CapitalFeasibilityInputV1,type PaperReservePolicy,type PaperReserveState,type PaperReserveSaleInput,type PaperReserveSaleLot} from '@coqui/core';
import type {ChannelRequest} from '@coqui/contracts';
import {currentBudget,readPaperReserveFact,type Db} from '@coqui/storage';
import {activePaperCapitalBinding,readPaperCapitalEvidence} from './paper-capital-evidence.js';
export type PaperReserveSalePreferences=ChannelRequest<'paper.reserve.sale.preview'>;
/** Reconstruct remaining acquisition lots only after the canonical local ledger reconciles.
 * Equal-time fills for one asset remain ambiguous; database/receipt order is not evidence.
 */
export function readPaperReserveSaleLots(profileId:string,atMs:number,db:Db):readonly PaperReserveSaleLot[]{
  const {financial}=readPaperCapitalEvidence(profileId,atMs,db);
  if(financial.reasonCodes.length||financial.realizedPnlUsd.state!=='available')throw new Error('sale_fifo_history_unavailable');
  const rows=db.prepare(`SELECT f.id,f.quantity_text q,f.execution_price_text p,f.venue_fee_text fee,f.filled_at at,o.side,o.canonical_asset_id asset
    FROM paper_fills_v3 f JOIN paper_orders_v3 o ON o.id=f.order_id WHERE f.profile_id=? AND f.filled_at<=? ORDER BY f.filled_at,f.id LIMIT 100001`).all(profileId,financial.toMs??atMs) as {id:string;q:string;p:string;fee:string;at:number;side:string;asset:string}[];
  if(rows.length>100000)throw new Error('sale_fifo_capacity');
  const queues=new Map<string,{id:string;q:ReturnType<typeof a>;basis:ReturnType<typeof a>;at:number}[]>(),times=new Set<string>();
  for(const f of rows){const key=`${f.asset}:${f.at}`;if(times.has(key))throw new Error('sale_fifo_order_unverified');times.add(key);
    const queue=queues.get(f.asset)??[];queues.set(f.asset,queue);
    if(f.side==='buy'){queue.push({id:f.id,q:a(f.q),basis:a(f.q).mul(f.p).add(f.fee),at:f.at});continue;}
    let left=a(f.q);while(left.gt(0)&&queue.length){const lot=queue[0]!,take=D.min(left,lot.q);lot.basis=lot.basis.sub(lot.basis.mul(take).div(lot.q));lot.q=lot.q.sub(take);left=left.sub(take);if(lot.q.isZero())queue.shift();}
    if(left.gt(0))throw new Error('sale_fifo_quantity_unreconciled');
  }
  const {binding}=activePaperCapitalBinding(profileId,db),budget=currentBudget(binding.scope_id,atMs,db)!;
  for(const id of new Set([...queues.keys(),...Object.keys(budget.positions)]))if(!(queues.get(id)??[]).reduce((sum,l)=>sum.add(l.q),a('0')).eq(budget.positions[id]??'0'))throw new Error('sale_fifo_quantity_unreconciled');
  const ref=capitalHash({scopeId:binding.scope_id,fills:rows});
  return [...queues].flatMap(([assetId,lots])=>lots.map(l=>({id:l.id,assetId,quantity:t(l.q),basisUsd:t(l.basis),acquiredAtMs:l.at,sequence:0,evidenceRef:ref})));
}
export function assemblePaperReserveSaleInput(profileId:string,atMs:number,preferences:PaperReserveSalePreferences,frame:CapitalFeasibilityInputV1,db:Db):PaperReserveSaleInput{
  const {binding}=activePaperCapitalBinding(profileId,db),policy=binding.policy_id?readPaperReserveFact<PaperReservePolicy>('policy',binding.policy_id,db):null,state=binding.state_id?readPaperReserveFact<PaperReserveState>('state',binding.state_id,db):null;
  if(!policy||!state)throw new Error('sale_policy_missing');
  const f=readPaperCapitalEvidence(profileId,atMs,db).financial,p=f.economicPnlUsd,r=f.realizedPnlUsd,prior=f.priorProfitBackedUsd;
  if(f.reasonCodes.length||p.state!=='available'||r.state!=='available'||prior.state!=='available')throw new Error('sale_profit_evidence_unavailable');
  const probe=evaluatePaperReserve(policy,state,f,unavailableReserveCapital(f.scopeId,f.budgetRevision,f.expiresAtMs,'sale_post_fill_reassessment_required'),atMs);
  if(probe.cycleCeilingUsd===null)throw new Error('sale_milestone_not_reached');
  const tax=D.max(0,a(policy.settings.taxHold.amountUsd).sub(state.taxHoldUsd));
  return {frame,lots:readPaperReserveSaleLots(profileId,atMs,db),policyId:policy.id,stateId:state.id,objective:{...preferences,
    economicBackingUsd:t(a(p.value).sub(prior.value)),realizedBackingUsd:t(a(r.value).sub(prior.value)),freshProfitUsd:t(D.max(0,D.min(p.value,probe.cycleCeilingUsd).sub(state.hUsd))),shareBps:policy.settings.shareBps,
    additionalTaxUsd:t(tax),profitBackedTaxUsd:policy.settings.taxHold.backing==='profit'?t(tax):'0',reviewRef:capitalHash({scopeId:binding.scope_id,policyId:policy.id,preferences})}};
}
