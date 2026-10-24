import {describe,it,expect} from 'vitest';
import {replayCapitalPath,BudgetDecimal as D} from '@coqui/core';
import {replayFixture,variantChange,rehash,REPLAY_ASSET as A,REPLAY_START as T,REPLAY_DAY as DAY} from './helpers/capital-replay.js';
describe('P4 deterministic joint-path mechanics, not alpha evidence',()=>{
 it.each(['decline','rebound','outage','missing','delayed-fees'] as const)('retains the complete capital grid under %s',kind=>{
  const {spec,tape}=replayFixture(4);const path=['1','0.6','0.3','0.2'];
  const t={...tape,market:tape.market.map((f,i)=>{const p=kind==='rebound'?['1','0.5','0.5','1.5'][i]!:kind==='decline'?path[i]!:'1';return {...f,assets:{[A]:{...f.assets[A]!,openUsd:kind==='missing'&&i===2?null:p,closeUsd:kind==='missing'&&i===2?null:p,bidUsd:kind==='missing'&&i===2?null:p,askUsd:kind==='missing'&&i===2?null:p,tradable:!(kind==='outage'&&i===0)}}};})};
  const s=variantChange({...rehash(spec,t),pathId:`synthetic-${kind}`},{cost:{...spec.variants[0]!.cost,feeRate:'0.0025',feePostingLagFrames:kind==='delayed-fees'?10:0}}),r=replayCapitalPath(s,t);
  expect(r.cells).toHaveLength(36);expect(r.variantInventory).toHaveLength(36);for(const c of r.cells)for(const mark of c.traces)expect(new D(mark.cashUsd).gte(0)).toBe(true);
  if(kind==='missing')expect(r.cells.some(c=>c.reasonCodes.includes('market_mark_missing'))).toBe(true);
  if(kind==='delayed-fees')expect(r.cells.filter(c=>c.cell.arm==='policy').every(c=>c.metrics['feesUsd']?.state==='unavailable')).toBe(true);
 });
 it('makes interrupted funding explicit without manufacturing return or suppressing cells',()=>{
  const {spec,tape}=replayFixture(4);const s=variantChange(spec,{flows:[{id:'periodic-one',atMs:T+DAY,sequence:0,kind:'contribution',amountUsd:'20',feeUsd:'0',userReceiptUsd:'0',purpose:'principal',linkedId:null,fromReserve:false,evidenceComplete:true}]});
  const r=replayCapitalPath(s,tape);for(const c of r.cells){expect(c.summary.contributionsUsd).toBe('20');expect(c.metrics['economicPnlUsd']).toMatchObject({value:'0'});}
 });
});
describe('P4 joint shocks and explicit incomplete books',()=>{
 it('replays a joint correlation shock across both instruments and every capital cell',()=>{
  const {spec,tape}=replayFixture(3),b='coinbase|spot|ETH-USD',prices=['1','0.5','0.2'];
  const t={market:tape.market.map((f,i)=>({...f,assets:Object.fromEntries([A,b].map(id=>[id,{...f.assets[A]!,openUsd:prices[i]!,closeUsd:prices[i]!,bidUsd:prices[i]!,askUsd:prices[i]!}]))})),decisions:tape.decisions.map(d=>({...d,targets:{[A]:'0.05',[b]:'0.05'},priority:[A,b]}))};
  const original=spec.rules[0]!,other={...original,assetId:b,rules:{...original.rules,assetId:b,productId:'ETH-USD',baseCurrency:'ETH'}};
  const s={...rehash(spec,t),pathId:'synthetic-correlated-shock',assets:[A,b],rules:[original,other],benchmarkWeights:{[A]:'0.05',[b]:'0.05'}};
  const r=replayCapitalPath(s,t);expect(r.cells).toHaveLength(36);for(const c of r.cells.filter(c=>c.cell.arm!=='cash')){expect(c.fills.some(f=>f.assetId===b)).toBe(true);expect(new D(c.summary.endingEquityUsd!).lt(c.cell.capitalUsd)).toBe(true);}
 });
 it('retains a delisted position as an unpriced residual rather than liquidating it at zero',()=>{
  const {spec,tape}=replayFixture(3),t={...tape,market:tape.market.map((f,i)=>i<2?f:{...f,assets:{[A]:{...f.assets[A]!,openUsd:null,closeUsd:null,bidUsd:null,askUsd:null,tradable:false}}})},s=rehash(spec,t),c=replayCapitalPath(s,t).cells[0]!;
  expect(c.summary.endingEquityUsd).toBeNull();expect(new D(c.traces.at(-1)!.positions[A]!).gt(0)).toBe(true);expect(c.metrics['economicPnlUsd']).toMatchObject({state:'unavailable'});
 });
 it('does not publish a stale terminal balance after an impossible funding event',()=>{
  const {spec,tape}=replayFixture(3),s=variantChange(spec,{flows:[{id:'cannot-pay',atMs:T+DAY,sequence:0,kind:'withdrawal',amountUsd:'600',feeUsd:'0',userReceiptUsd:'600',purpose:'principal',linkedId:null,fromReserve:false,evidenceComplete:true}]});
  const c=replayCapitalPath(s,tape).cells.find(c=>c.cell.id==='base:cash:500')!;expect(c.summary.endingEquityUsd).toBeNull();expect(c.metrics['economicPnlUsd']).toMatchObject({state:'unavailable'});expect(c.reasonCodes).toContain('execution_history_incomplete');expect(c.summary.receiptsUsd).toBe('0');
 });
});
