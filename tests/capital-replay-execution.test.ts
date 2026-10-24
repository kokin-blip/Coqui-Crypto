import {describe,it,expect} from 'vitest';
import fc from 'fast-check';
import {replayCapitalCell,createReplayBook,applyReplayFill,BudgetDecimal as D,replayRulesAt,nativeExecutionRules,knownNativeRule} from '@coqui/core';
import {replayFixture,variantChange,rehash,REPLAY_ASSET as A,REPLAY_START as T} from './helpers/capital-replay.js';
describe('P4 modeled execution with real shared budgets',()=>{
 it('does not retry an unknown order or spend its held cash',()=>{
  const {spec,tape}=replayFixture();const t={...tape,decisions:tape.decisions.map(d=>({...d,fill:{fraction:'0',delayFrames:null}}))};const s=rehash(spec,t),c=replayCapitalCell(s,t,s.cells.find(c=>c.id==='base:policy:500')!);
  expect(c.fills).toHaveLength(0);expect(c.reasonCodes).toContain('pending_order_unresolved');expect(c.traces.at(-1)?.spendableUsd).toBe('475');expect(c.events.filter(e=>e.kind==='blocked_pending')).toHaveLength(2);
 });
 it('settles partial fills before any new spend and deduplicates an applied fill',()=>{
  const {spec,tape}=replayFixture();const t={...tape,decisions:tape.decisions.map(d=>({...d,fill:{fraction:'0.5',delayFrames:0}}))};const s=rehash(spec,t),c=replayCapitalCell(s,t,s.cells.find(c=>c.id==='base:policy:500')!);
  expect(c.fills.slice(0,2).map(f=>f.quantity)).toEqual(['12.5','12.5']);expect(c.fills[1]?.atMs).toBeGreaterThan(c.fills[0]!.atMs);
  const b=createReplayBook(c.scopeId,s.openings.find(o=>o.capitalUsd==='500')!);applyReplayFill(b,c.fills[0]!);const before={cash:b.cash,positions:{...b.positions},events:b.events.length};applyReplayFill(b,c.fills[0]!);expect({cash:b.cash,positions:b.positions,events:b.events.length}).toEqual(before);
 });
 it('never funds a buy with a delayed sell intention',()=>{
  const {spec,tape}=replayFixture();const t={...tape,decisions:tape.decisions.map(d=>({...d,targets:{},fill:{fraction:'0',delayFrames:null}}))};const s={...rehash(spec,t),openings:spec.openings.map(o=>o.capitalUsd==='500'?{...o,cashUsd:'0',assets:[{assetId:A,quantity:'500',costUsd:'500'}]}:o)};
  const c=replayCapitalCell(s,t,s.cells.find(c=>c.id==='base:policy:500')!);expect(c.fills).toHaveLength(0);expect(c.traces.at(-1)?.cashUsd).toBe('0');expect(c.traces.at(-1)?.positions[A]).toBe('500');
 });
 it('counts each friction component once across generated exact purchases',()=>{
  fc.assert(fc.property(fc.integer({min:0,max:80}),fc.integer({min:0,max:25}),fc.integer({min:0,max:25}),(fee,spread,slip)=>{
   const {spec,tape}=replayFixture(1),market=tape.market.map(f=>({...f,assets:{[A]:{...f.assets[A]!,bidUsd:null,askUsd:null,quoteAtMs:null}}}));
   const t={...tape,market},s=variantChange(rehash(spec,t),{cost:{...spec.variants[0]!.cost,feeRate:new D(fee).div(10000).toFixed(),spreadBps:String(spread),slippageBps:String(slip)}}),c=replayCapitalCell(s,t,s.cells.find(c=>c.id==='base:policy:500')!);
   const total=c.fills.reduce((sum,f)=>sum.add(f.feeUsd).add(f.spreadUsd).add(f.slippageUsd).add(f.impactUsd),new D(0));expect(new D(500).sub(c.summary.endingEquityUsd!).sub(total).abs().lt('0.000000000001')).toBe(true);expect(new D(c.traces.at(-1)!.cashUsd).gte(0)).toBe(true);
  }),{numRuns:25});
 });
 it('preserves original native-rule observation provenance and rejects stale historical observations',()=>{
  const {spec,tape}=replayFixture();const r=replayRulesAt(spec.rules[0]!,T);expect(r.assurance).toBe('scenario');expect(JSON.parse(r.rawEvidenceJson).originalObservedAtMs).toBe(0);
  const s={...spec,rules:spec.rules.map(r=>({...r,mode:'historical_observation' as const}))};const c=replayCapitalCell(s,tape,s.cells[0]!);expect(c.fills).toHaveLength(0);expect(c.reasonCodes).toContain('native_rules_stale');
 });
 it('does not override hard stops, unknown fee currency or missing quotes',()=>{
  const {spec,tape}=replayFixture();for(const cost of [{...spec.variants[0]!.cost,feeCurrency:'unsupported' as const},{...spec.variants[0]!.cost,feeBasis:'reference_notional' as const}]){const s=variantChange(spec,{cost});expect(replayCapitalCell(s,tape,s.cells[0]!).fills).toHaveLength(0);}
  const s=variantChange(spec,{policy:{...spec.variants[0]!.policy,killSwitchEngaged:true}});expect(replayCapitalCell(s,tape,s.cells[0]!).fills).toHaveLength(0);
 });
});
describe('P4 explicit friction stress conventions',()=>{
 it('doubles supplied spread and proportional fees while retaining fixed cost once',()=>{
  const {spec,tape}=replayFixture(1),t={...tape,market:tape.market.map(f=>({...f,assets:{[A]:{...f.assets[A]!,bidUsd:'0.99',askUsd:'1.01'}}}))};
  const s=variantChange(rehash(spec,t),{cost:{...spec.variants[0]!.cost,multiplier:2,feeRate:'0.001',fixedUsd:'1'}}),c=replayCapitalCell(s,t,s.cells.find(c=>c.id==='base:policy:500')!);
  const f=c.fills[0]!;expect(f.executionPriceUsd).toBe('1.02');expect(new D(f.spreadUsd).eq(new D(f.quantity).mul('.02'))).toBe(true);expect(new D(f.feeUsd).eq(new D(f.notionalUsd).mul('.002').add(1))).toBe(true);
  expect(new D(500).sub(c.summary.endingEquityUsd!).eq(new D(f.feeUsd).add(f.spreadUsd))).toBe(true);
 });
});

describe('P4 native exit boundaries in the actual replay loop',()=>{
 it.each(['0.001','0.002','0.003'])('retains the exact native minimum boundary for %s units',quantity=>{
  const {spec,tape}=replayFixture(1),t={...tape,decisions:tape.decisions.map(d=>({...d,targets:{},riskExits:[A]}))};
  const s=variantChange({...rehash(spec,t),openings:spec.openings.map(o=>o.capitalUsd==='50'?{...o,cashUsd:new D(50).sub(quantity).toFixed(),assets:[{assetId:A,quantity,costUsd:quantity}]}:o),rules:spec.rules.map(r=>({...r,rules:nativeExecutionRules({...r.rules,quantityMin:knownNativeRule('0.002')})}))},{policy:{...spec.variants[0]!.policy,discretionaryFloorUsd:'25',riskExitBypassesDiscretionaryFloor:true}});
  const c=replayCapitalCell(s,t,s.cells.find(c=>c.id==='base:policy:50')!);
  if(quantity==='0.001'){expect(c.fills).toHaveLength(0);expect(c.traces.at(-1)?.positions[A]).toBe(quantity);expect(c.feasibility.some(f=>f.riskResiduals.length>0)).toBe(true);}
  else{expect(c.fills).toHaveLength(1);expect(c.fills[0]?.quantity).toBe(quantity);expect(c.traces.at(-1)?.positions[A]).toBe('0');}
 });
});
