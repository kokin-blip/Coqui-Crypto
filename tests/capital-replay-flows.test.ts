import {describe,it,expect} from 'vitest';
import {replayCapitalCell} from '@coqui/core';
import {replayFixture,variantChange,REPLAY_START as T,REPLAY_DAY as DAY} from './helpers/capital-replay.js';
import type {ReplayFlow} from '@coqui/core';
const flow=(changes:Partial<ReplayFlow>={}):ReplayFlow=>({id:'out',atMs:T+DAY,sequence:0,kind:'withdrawal',amountUsd:'100',feeUsd:'2',userReceiptUsd:'100',purpose:'principal',linkedId:null,fromReserve:false,evidenceComplete:true,...changes});
describe('P4 dated capital flow and metric boundaries',()=>{
 it('separates a $102 debit from the $100 receipt and $2 investment cost',()=>{
  const {spec,tape}=replayFixture();const s=variantChange(spec,{flows:[flow()]});const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:cash:500')!);
  expect(c.summary).toMatchObject({endingEquityUsd:'398',outflowsUsd:'100',receiptsUsd:'100',feesUsd:'2'});expect(c.metrics['economicPnlUsd']).toMatchObject({value:'-2'});
 });
 it('counts pending receivable once and does not claim early receipt',()=>{
  const {spec,tape}=replayFixture();const pending=flow({kind:'pending_outflow'});const s=variantChange(spec,{flows:[pending]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:cash:500')!);expect(c.summary).toMatchObject({endingEquityUsd:'498',outflowsUsd:'0',receiptsUsd:'0',feesUsd:'2'});
  expect(c.traces.at(-1)).toMatchObject({cashUsd:'398',pendingUsd:'100'});
  const complete=variantChange(s,{flows:[pending,flow({id:'confirm',kind:'confirm_outflow',linkedId:'out',feeUsd:'0',atMs:T+2*DAY})]});
  const result=replayCapitalCell(complete,tape,complete.cells.find(c=>c.id==='base:cash:500')!);expect(result.summary).toMatchObject({endingEquityUsd:'398',outflowsUsd:'100',receiptsUsd:'100',feesUsd:'2'});
 });
 it('keeps unavailable timing distinct from zero and preserves daily gaps',()=>{
  const {spec,tape}=replayFixture(5);const gapped={...tape,market:tape.market.filter((_,i)=>i!==1&&i!==2)};
  const s=variantChange({...spec,marketTapeHash:(awaitHash(gapped.market))},{flows:[flow({atMs:T+DAY+1000})]});
  const c=replayCapitalCell(s,gapped,s.cells.find(c=>c.id==='base:cash:500')!);expect(c.metrics['economicPnlUsd']).toMatchObject({state:'unavailable'});expect(c.reasonCodes).toContain('flow_time_mark_unavailable');
  const noFlows=variantChange(s,{flows:[]});const r=replayCapitalCell(noFlows,gapped,noFlows.cells.find(c=>c.id==='base:cash:500')!);
  expect(r.metrics['timeWeightedReturnPct']).toMatchObject({state:'available',value:'0'});expect(r.metrics['volatilityPct']).toMatchObject({state:'unavailable'});
 });
 it('does not reuse known future fee evidence at an earlier reserve review',()=>{
  const {spec,tape}=replayFixture();const s=variantChange(spec,{cost:{...spec.variants[0]!.cost,feeRate:'0.0025',feePostingLagFrames:5},reviewAtMs:[T+DAY]});
  const c=replayCapitalCell(s,tape,s.cells[0]!);expect(c.metrics['feesUsd']).toMatchObject({state:'unavailable'});expect(c.reservePreviews[0]?.reasonCodes).toContain('fee_accounting_incomplete');
 });
 it('supports full redemption and linked later funding without resetting H',()=>{
  const {spec,tape}=replayFixture(4);const s=variantChange(spec,{flows:[flow({kind:'withdrawal',amountUsd:'500',feeUsd:'0',userReceiptUsd:'500'}),flow({id:'new-funding',atMs:T+2*DAY,kind:'contribution',amountUsd:'100',feeUsd:'0',userReceiptUsd:'0'})]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:cash:500')!);expect(c.summary.endingEquityUsd).toBe('100');expect(c.totalPerformance.length).toBeGreaterThan(1);expect(c.metrics['economicPnlUsd']).toMatchObject({value:'0'});
 });
});
import {capitalHash as awaitHash} from '@coqui/core';
describe('P4 incomplete financial evidence',()=>{
 it('never turns an unverified modeled withdrawal into a confirmed receipt or zero outcome',()=>{
  const {spec,tape}=replayFixture(),s=variantChange(spec,{flows:[flow({evidenceComplete:false})]}),c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:cash:500')!);
  expect(c.summary.receiptsUsd).toBe('0');expect(c.summary.endingEquityUsd).toBeNull();expect(c.metrics['confirmedUserReceiptsUsd']).toMatchObject({state:'unavailable'});expect(c.metrics['economicPnlUsd']).toMatchObject({state:'unavailable'});
 });
});
