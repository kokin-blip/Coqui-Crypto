import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {replayCapitalPath,CAPITAL_REPLAY_GRID} from '@coqui/core';
import {replayFixture,variantChange,rehash,REPLAY_START as T,REPLAY_DAY as DAY} from './helpers/capital-replay.js';
const expected=JSON.parse(readFileSync(new URL('../docs/implementation/evidence/p5-strategy-planning-2026-10-23/probes.json',import.meta.url),'utf8')) as {frozenP4:{kind:string;resultId:string}[]};
describe('P4 frozen complete-result compatibility gate',()=>{
 for(const entry of expected.frozenP4)it(entry.kind,()=>{
  const {spec:initial,tape:raw}=replayFixture(4);let spec=initial,tape=raw;
  const flow={id:'funding',atMs:T+DAY,sequence:0,kind:'contribution' as const,amountUsd:'20',feeUsd:'0',userReceiptUsd:'0',purpose:'principal' as const,linkedId:null,fromReserve:false,evidenceComplete:true};
  if(entry.kind==='contribution')spec=variantChange(spec,{flows:[flow]});
  if(entry.kind==='received-fee')spec=variantChange(spec,{cost:{...spec.variants[0]!.cost,feeCurrency:'received',feeRate:'0.0025'}});
  if(entry.kind==='partial-fill'){tape={...tape,decisions:tape.decisions.map(d=>({...d,fill:{fraction:'0.5',delayFrames:0}}))};spec=rehash(spec,tape);}
  if(entry.kind==='unknown-flow')spec=variantChange(spec,{flows:[{...flow,kind:'withdrawal',userReceiptUsd:'20',evidenceComplete:false}]});
  if(entry.kind==='reserve'){
   tape={...tape,decisions:tape.decisions.map(d=>({...d,status:'abstain',targets:{}}))};spec=variantChange(rehash(spec,tape),{reserve:{...spec.variants[0]!.reserve,goal:'preview',shareBps:2500},operatingObjective:'cash_only',reviewAtMs:[T+DAY,T+2*DAY,T+3*DAY],flows:[{...flow,id:'gain',kind:'income',amountUsd:'50',purpose:'other'}]});
   spec={...spec,cells:[...spec.cells,...CAPITAL_REPLAY_GRID.map(capitalUsd=>({id:`base:reinvest:${capitalUsd}`,capitalUsd,variantId:'base',arm:'reinvest' as const}))]};
  }
  expect(replayCapitalPath(spec,tape).id).toBe(entry.resultId);
 });
});
