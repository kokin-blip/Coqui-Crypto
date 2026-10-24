import {describe,it,expect} from 'vitest';
import {capitalHash,replayContestCell,applyModeledReserve,BudgetDecimal as D,type ReservePolicy,type ReserveState} from '@coqui/core';
import {contestFixture} from './helpers/capital-contest.js';
describe('P5 distribution policies remain simulation hypotheses',()=>{
 it('separates strict realized backing from economic cash, without inventing realized gain or weakening P3',()=>{
  const {manifest:base,data:raw,A}=contestFixture(3);
  const market=raw.market.map((r,i)=>({...r,assets:Object.fromEntries(Object.entries(r.assets).map(([id,a])=>[id,id===A?{...a,openUsd:String(1+i/10),closeUsd:String(1+(i+1)/10)}:a]))}));
  const data={...raw,market},candidates=base.candidates.map(c=>c.id==='T1'?{...c,cadenceDays:7,baseWeights:{[A]:'0.2'}}:c);
  const variant={...base.replay.variants[0]!,operatingObjective:'fixed_request' as const,reserve:{...base.replay.variants[0]!.reserve,trigger:{kind:'profit_usd' as const,value:'1'},cadence:'daily' as const}};
  const replay={...base.replay,marketTapeHash:capitalHash(market),openings:base.replay.openings.map(o=>({...o,cashUsd:new D(o.capitalUsd).mul('0.8').toFixed(),assets:[{assetId:A,quantity:new D(o.capitalUsd).mul('0.2').toFixed(),costUsd:new D(o.capitalUsd).mul('0.2').toFixed()}]})),variants:[variant]};
  const strict={...base.arms[0]!,id:'strict',group:'R' as const,selectable:false,shareBps:2500},economic={...strict,id:'economic',capMode:'economic_cash_review' as const};
  const m={...base,dataHash:capitalHash(data),candidates,replay,scenarios:[variant],arms:[...base.arms,strict,economic]};
  const trial={id:'strict:500',armId:'strict',capitalUsd:'500',variantId:'base'},s=replayContestCell(m,data,trial),e=replayContestCell(m,data,{...trial,id:'economic:500',armId:'economic'},()=>{},s.decisions);
  expect(s.result.summary.reservedUsd).toBe('0');expect(s.saleConsequences.find(c=>c.status==='hypothetical_full_exit')).toMatchObject({quantity:'100',notionalUsd:'110',realizedGainUsd:'10',fundsEligibility:false});expect(s.result.summary.executedFills).toBe(0);expect(e.result.summary.reservedUsd).toBe('5');expect(e.result.metrics['realizedPnlUsd']).toMatchObject({state:'available',value:'0'});expect(e.result.reserveState?.hUsd).toBe('20');expect(e.targetHash).toBe(s.targetHash);
  const preview=e.result.reservePreviews.find(p=>p.state==='eligible')!;expect(preview.caps.realizedUsd).toMatchObject({state:'available',value:'0'});
  const inputs=JSON.parse(preview.inputsJson) as {policy:ReservePolicy;state:ReserveState};expect(()=>applyModeledReserve(inputs.policy,inputs.state,preview,'forbidden',preview.evaluatedAtMs)).toThrow('invalid');
  expect(new D(e.result.summary.endingEquityUsd!).sub(e.result.summary.activeUsd!)).toEqual(new D('5'));expect(e.result.summary.receiptsUsd).toBe('0');
 });
 it('freezes matched targets across 0/25/50% and batch/floor sensitivities',()=>{const {manifest:m,data}=contestFixture(),t=m.trials.find(t=>t.id==='T1:base:500')!,ref=replayContestCell(m,data,t);for(const shareBps of [0,2500,5000]){const a={...m.arms[0]!,id:`R${shareBps}`,group:'R' as const,selectable:false,shareBps,minimumBatchUsd:'1',retainedCapitalUsd:'400'},mm={...m,arms:[...m.arms,a]};expect(replayContestCell(mm,data,{...t,id:a.id,armId:a.id},()=>{},ref.decisions).targetHash).toBe(ref.targetHash);}});
});
