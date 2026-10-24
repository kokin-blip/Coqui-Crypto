import {describe,it,expect} from 'vitest';
import {replayCapitalCell,CAPITAL_REPLAY_GRID,capitalHash,type ReplayFlow} from '@coqui/core';
import {replayFixture,variantChange,rehash,REPLAY_ASSET as A,REPLAY_START as T,REPLAY_DAY as DAY} from './helpers/capital-replay.js';
function reserveFixture(days=4){
 const {spec,tape}=replayFixture(days);const t={...tape,decisions:tape.decisions.map(d=>({...d,status:'abstain' as const,targets:{}}))};
 const s=variantChange(rehash(spec,t),{reserve:{...spec.variants[0]!.reserve,goal:'preview',shareBps:2500},operatingObjective:'cash_only',reviewAtMs:Array.from({length:days-1},(_,i)=>T+(i+1)*DAY),flows:[income('gain',1,'50')]});
 return {tape:t,spec:{...s,cells:[...s.cells,...CAPITAL_REPLAY_GRID.map(capitalUsd=>({id:`base:reinvest:${capitalUsd}`,capitalUsd,variantId:'base',arm:'reinvest' as const}))]}};
}
function income(id:string,day:number,amountUsd:string):ReplayFlow{return {id,atMs:T+day*DAY,sequence:0,kind:'income',amountUsd,feeUsd:'0',userReceiptUsd:'0',purpose:'other',linkedId:null,fromReserve:false,evidenceComplete:true};}
describe('P4 actual reserve replay integration',()=>{
 it('reserves $12.50 of a $50 realized gain, without duplicating cash or manufacturing a receipt',()=>{
  const {spec,tape}=reserveFixture();const c=replayCapitalCell(spec,tape,spec.cells.find(c=>c.id==='base:policy:500')!);
  expect(c.assessments).toHaveLength(1);expect(c.summary).toMatchObject({endingEquityUsd:'550',activeUsd:'537.5',reservedUsd:'12.5',receiptsUsd:'0'});
  expect(c.reserveState).toMatchObject({hUsd:'50',allocatedUsd:'12.5'});expect(c.traces.at(-1)).toMatchObject({spendableUsd:'537.5'});
  expect(c.metrics['economicPnlUsd']).toMatchObject({value:'50'});expect(c.metrics['sleeveTimeWeightedReturnPct']).toMatchObject({state:'available',value:'10'});
 });
 it('preserves H through releases, confirmed modeled payouts and deposit-only growth',()=>{
  const {spec,tape}=reserveFixture();const payout:ReplayFlow={...income('payout',2,'10'),kind:'withdrawal',userReceiptUsd:'10',purpose:'profit',fromReserve:true};
  const s=variantChange(spec,{flows:[...spec.variants[0]!.flows,payout,{...income('deposit',3,'200'),kind:'contribution',purpose:'principal'}]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:policy:500')!);
  expect(c.assessments).toHaveLength(1);expect(c.reserveState?.hUsd).toBe('50');expect(c.summary).toMatchObject({endingEquityUsd:'740',reservedUsd:'2.5',receiptsUsd:'10',activeUsd:'737.5'});
  expect(c.metrics['economicPnlUsd']).toMatchObject({value:'50'});
 });
 it('retains losses and the exact partial 33% slice instead of recycling old profit',()=>{
  const {spec,tape}=reserveFixture(5);const v=spec.variants[0]!;
  const s=variantChange(spec,{reserve:{...v.reserve,shareBps:3300,retainedCapitalUsd:'140'},reviewAtMs:[T+DAY],flows:[income('gain',1,'100')]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:policy:50')!);
  expect(c.assessments[0]).toMatchObject({assessedProfitUsd:'30.31',reserveUsd:'10',hAfterUsd:'30.31'});
  const loss=variantChange(spec,{flows:[income('gain',1,'50'),{...income('loss',2,'50'),kind:'fee_adjustment'},income('recover',3,'50')]});
  const r=replayCapitalCell(loss,tape,loss.cells.find(c=>c.id==='base:policy:500')!);expect(r.assessments).toHaveLength(1);expect(r.reserveState?.hUsd).toBe('50');expect(r.metrics['economicPnlUsd']).toMatchObject({value:'50'});
 });
 it.each(['profit_usd','growth_bps','balance_usd'] as const)('uses the original %s trigger and fixed base',kind=>{
  const {spec,tape}=reserveFixture();const s=variantChange(spec,{reserve:{...spec.variants[0]!.reserve,trigger:{kind,value:kind==='profit_usd'?'50':kind==='growth_bps'?'1000':'550'}}});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:policy:500')!);expect(c.assessments).toHaveLength(1);
 });
 it('blocks a deposit-only balance crossing, wins and unproved fixed operating request',()=>{
  const {spec,tape}=reserveFixture();const s=variantChange(spec,{reserve:{...spec.variants[0]!.reserve,trigger:{kind:'balance_usd',value:'550'},reviewWinCount:1},operatingObjective:'fixed_request',flows:[{...income('deposit',1,'200'),kind:'contribution'}]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:policy:500')!);expect(c.assessments).toHaveLength(0);expect(c.reservePreviews[0]?.reasonCodes).toContain('fixed_strategy_request_missing_or_unnetted');expect(c.reserveState?.baseUsd).toBe('500');
 });
 it('keeps opening basis unknown without hiding independently supported economic profit',()=>{
  const {spec,tape}=replayFixture(2);const t={...tape,market:tape.market.map((f,i)=>({...f,assets:{[A]:{...f.assets[A]!,openUsd:i?'1.1':'1',closeUsd:i?'1.1':'1',bidUsd:i?'1.1':'1',askUsd:i?'1.1':'1'}}})),decisions:tape.decisions.map((d,i)=>({...d,targets:{},status:i===0?'not_scheduled' as const:'abstain' as const}))};
  const s={...rehash(spec,t),openings:spec.openings.map(o=>o.capitalUsd==='500'?{...o,cashUsd:'400',assets:[{assetId:A,quantity:'100',costUsd:null}]}:o)};
  const c=replayCapitalCell(s,t,s.cells.find(c=>c.id==='base:policy:500')!);expect(c.metrics['economicPnlUsd']).toMatchObject({state:'available',value:'10'});expect(c.metrics['realizedPnlUsd']).toMatchObject({state:'unavailable'});expect(capitalHash(c)).toHaveLength(64);
 });
});
describe('P4 reserve obligations through later stress',()=>{
 it('keeps an underfunded modeled reserve and incident instead of silently releasing it',()=>{
  const {spec,tape}=reserveFixture(4),s=variantChange(spec,{flows:[...spec.variants[0]!.flows,{...income('principal-out',2,'545'),kind:'withdrawal',purpose:'principal'}]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:policy:500')!);expect(c.summary.reservedUsd).toBe('12.5');expect(c.summary.endingEquityUsd).toBe('5');expect(c.reasonCodes).toContain('reserve_or_order_underfunded');expect(c.assessments).toHaveLength(1);expect(c.events.some(e=>e.kind==='modeled_incident')).toBe(true);
 });
 it('deducts a later fee correction once and does not reassess the original profit on recovery',()=>{
  const {spec,tape}=reserveFixture(4),s=variantChange(spec,{flows:[...spec.variants[0]!.flows,{...income('late-fee',2,'2'),kind:'fee_adjustment'},income('fee-recovery',3,'2')]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:policy:500')!);expect(c.summary.endingEquityUsd).toBe('550');expect(c.summary.feesUsd).toBe('2');expect(c.assessments).toHaveLength(1);expect(c.reserveState?.hUsd).toBe('50');
 });
});
