import {describe,it,expect} from 'vitest';
import {replayCapitalPath,replayCapitalCell,validateCapitalReplay,capitalHash,CAPITAL_REPLAY_GRID} from '@coqui/core';
import {replayFixture,variantChange,rehash,REPLAY_ASSET as A,REPLAY_START as T,REPLAY_DAY as DAY} from './helpers/capital-replay.js';
describe('P4 independently funded replay books',()=>{
 it('replays every capital and matched control independently with frozen targets',()=>{
  const {spec,tape}=replayFixture();const r=replayCapitalPath(spec,tape);
  expect(r.cells).toHaveLength(36);expect(r.confirmatoryEligible).toBe(false);
  for(const capital of CAPITAL_REPLAY_GRID){const c=r.cells.find(c=>c.cell.id===`base:policy:${capital}`)!;
   expect(c.summary.endingEquityUsd).toBe(capital);expect(c.fills[0]?.notionalUsd).toBe(String(Number(capital)*.05));expect(c.metrics['timeWeightedReturnPct']).toMatchObject({state:'available',value:'0'});}
  expect(replayCapitalPath(spec,tape).id).toBe(r.id);
 });
 it('reports native/discretionary infeasibility without increasing risk',()=>{
  const {spec,tape}=replayFixture();const s=variantChange(spec,{policy:{...spec.variants[0]!.policy,discretionaryFloorUsd:'25',maxEntryFraction:'0.05'}});
  const c=replayCapitalCell(s,tape,s.cells[0]!);expect(c.fills).toHaveLength(0);expect(c.summary.blockedOrders).toBeGreaterThan(0);expect(c.summary.endingEquityUsd).toBe('50');
 });
 it('charges a received-asset buy fee exactly once through delivered units and exact cash basis',()=>{
  const {spec,tape}=replayFixture(1);const t={...tape,decisions:tape.decisions.map(d=>({...d,targets:{[A]:'0.1'}}))};
  const s=variantChange(rehash(spec,t),{cost:{...spec.variants[0]!.cost,feeCurrency:'received',feeRate:'0.0025'}});
  const c=replayCapitalCell(s,t,s.cells.find(c=>c.id==='base:policy:100')!);
  expect(c.fills[0]).toMatchObject({cashDebitUsd:'10',deliveredQuantity:'9.975',feeUsd:'0.025',feeQuantity:'0.025'});
  expect(c.summary.endingEquityUsd).toBe('99.975');expect(c.metrics['unrealizedPnlUsd']).toMatchObject({state:'available',value:'-0.025'});
 });
 it('binds the entire tape and rejects future decisions, missing grid and provider identity',()=>{
  const {spec,tape}=replayFixture();expect(()=>validateCapitalReplay({...spec,cells:spec.cells.slice(1)},tape)).toThrow('matched_grid');
  expect(()=>validateCapitalReplay(spec,{...tape,decisions:[]})).toThrow('hash');
  const t={...tape,decisions:tape.decisions.map(d=>({...d,availableAtMs:d.executionAtMs+1}))};expect(()=>validateCapitalReplay(rehash(spec,t),t)).toThrow('noncausal');
  expect(()=>validateCapitalReplay({...spec,provider:'alpaca'},tape)).toThrow();expect(capitalHash(spec)).toHaveLength(64);
 });
 it('preserves deposits as funding and leaves investment returns unchanged at every size',()=>{
  const {spec,tape}=replayFixture();const s=variantChange(spec,{flows:[{id:'deposit',atMs:T+DAY,sequence:0,kind:'contribution',amountUsd:'20',feeUsd:'0',userReceiptUsd:'0',purpose:'principal',linkedId:null,fromReserve:false,evidenceComplete:true}]});
  const r=replayCapitalPath(s,tape);
  for(const c of r.cells){expect(c.summary.endingEquityUsd).toBe(String(Number(c.cell.capitalUsd)+20));expect(c.metrics['economicPnlUsd']).toMatchObject({state:'available',value:'0'});expect(c.metrics['timeWeightedReturnPct']).toMatchObject({state:'available',value:'0'});}
 });
});
