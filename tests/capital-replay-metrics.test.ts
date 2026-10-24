import {describe,it,expect} from 'vitest';
import {replayCapitalCell,BudgetDecimal as D} from '@coqui/core';
import {replayFixture,variantChange,rehash,REPLAY_START as T,REPLAY_DAY as DAY,REPLAY_ASSET as A} from './helpers/capital-replay.js';
describe('P4 complete time and metric scope',()=>{
 it('accrues each full day once, without paying interest on a later deposit retroactively',()=>{
  const {spec,tape}=replayFixture(2);const s=variantChange(spec,{activeDailyYield:'0.01',flows:[{id:'deposit',atMs:T+DAY,sequence:0,kind:'contribution',amountUsd:'20',feeUsd:'0',userReceiptUsd:'0',purpose:'principal',linkedId:null,fromReserve:false,evidenceComplete:true}]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:cash:500')!);expect(c.summary.endingEquityUsd).toBe('530.25');expect(c.metrics['economicPnlUsd']).toMatchObject({value:'10.25'});expect(c.metrics['timeWeightedReturnPct']).toMatchObject({value:'2.01'});
 });
 it('separates account P&L and user-net fixed expenses and personal tax payments',()=>{
  const {spec,tape}=replayFixture(2);const s=variantChange(spec,{externalExpenses:[{atMs:T,amountUsd:'5'}],flows:[{id:'paid-tax',atMs:T+DAY,sequence:0,kind:'withdrawal',amountUsd:'20',feeUsd:'0',userReceiptUsd:'0',purpose:'personal_tax',linkedId:null,fromReserve:false,evidenceComplete:true}]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:cash:500')!);expect(c.summary).toMatchObject({endingEquityUsd:'480',userNetOutcomeUsd:'475',receiptsUsd:'0'});expect(c.metrics['economicPnlUsd']).toMatchObject({value:'0'});
 });
 it('keeps annualization unavailable for short periods and uses actual elapsed time after one year',()=>{
  const f=replayFixture(2),short=replayCapitalCell(f.spec,f.tape,f.spec.cells[0]!);expect(short.metrics['annualizedReturnPct']).toMatchObject({state:'unavailable',reasonCodes:['less_than_one_year']});
  const {spec,tape}=replayFixture(365),s=variantChange(spec,{activeDailyYield:'0.001'}),c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:cash:500')!);
  const expected=new D('1.001').pow(365).sub(1).mul(100);expect(c.metrics['annualizedReturnPct']?.state).toBe('available');if(c.metrics['annualizedReturnPct']?.state==='available')expect(new D(c.metrics['annualizedReturnPct'].value).sub(expected).abs().lt('0.000000001')).toBe(true);
 });
 it('does not stitch across total loss and later funding or erase cumulative loss',()=>{
  const {spec,tape}=replayFixture(4);const s=variantChange(spec,{flows:[{id:'total-loss',atMs:T+DAY,sequence:0,kind:'fee_adjustment',amountUsd:'500',feeUsd:'0',userReceiptUsd:'0',purpose:'other',linkedId:null,fromReserve:false,evidenceComplete:true},{id:'refund-capital',atMs:T+2*DAY,sequence:0,kind:'contribution',amountUsd:'100',feeUsd:'0',userReceiptUsd:'0',purpose:'principal',linkedId:null,fromReserve:false,evidenceComplete:true}]});
  const c=replayCapitalCell(s,tape,s.cells.find(c=>c.id==='base:cash:500')!);expect(c.summary.endingEquityUsd).toBe('100');expect(c.metrics['economicPnlUsd']).toMatchObject({value:'-500'});expect(c.metrics['timeWeightedReturnPct']).toMatchObject({state:'unavailable'});expect(c.totalPerformance.length).toBeGreaterThan(1);
 });
 it('keeps prior numerical outcomes when future prices are changed',()=>{
  const {spec,tape}=replayFixture(4);const future={...tape,market:tape.market.map((f,i)=>i<2?f:{...f,assets:{[A]:{...f.assets[A]!,openUsd:'2',closeUsd:'2',bidUsd:'2',askUsd:'2'}}})};
  const a=replayCapitalCell(spec,tape,spec.cells[0]!),s=rehash(spec,future),b=replayCapitalCell(s,future,s.cells[0]!);
  expect(b.traces.slice(0,4).map(t=>[t.cashUsd,t.equityUsd,t.positions])).toEqual(a.traces.slice(0,4).map(t=>[t.cashUsd,t.equityUsd,t.positions]));
 });
});
