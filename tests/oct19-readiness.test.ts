import { describe,it,expect } from 'vitest';
import { operationalReadinessAction, evidenceAge } from '../apps/desktop/src/renderer/app/readiness-action.js';
import type { ChannelResponse } from '@coqui/contracts';
const ready=<T>(value:T)=>({kind:'ready' as const,value,isStale:false});
function input(){return {status:ready({killSwitchEngaged:false} as ChannelResponse<'app.status-rail'>),
 paper:ready({reconciliationAttention:{blocked:false}} as ChannelResponse<'parallel.paper.status'>),
 feed:ready({connection:'live'} as ChannelResponse<'market-data.live'>),study:ready({status:'passed'} as ChannelResponse<'research.edge-study'>)};}
describe('operational readiness action',()=>{
 it('prioritizes safety and paper uncertainty over feed and research',()=>{
  const x=input();x.status.value={...x.status.value,killSwitchEngaged:true};x.paper.value={...x.paper.value,reconciliationAttention:{...x.paper.value.reconciliationAttention,blocked:true}};
  expect(operationalReadinessAction(x).route).toBe('#/operations');
  x.status.value={...x.status.value,killSwitchEngaged:false};expect(operationalReadinessAction(x).title).toBe('Paper orders need reconciliation');
 });
 it('never treats unavailable safety or paper evidence as ready',()=>{
  const x=input();expect(operationalReadinessAction({...x,paper:{kind:'unknown',issues:[]}}).title).toBe('Operational evidence is not verified');
  expect(operationalReadinessAction({...x,status:{kind:'loading'}}).route).toBe('#/operations');
 });
 it('routes feed, qualification and completed evidence to existing destinations',()=>{
  const x=input();expect(operationalReadinessAction({...x,feed:{kind:'failed',issues:[]}}).route).toBe('#/markets');
  expect(operationalReadinessAction({...x,study:ready({...x.study.value,status:'not_registered'})}).route).toBe('#/research');
  expect(operationalReadinessAction(x).route).toBe('#/activity');
 });
 it('does not invent an evidence age for missing or future timestamps',()=>{
  expect(evidenceAge(null,1000)).toBe('age unknown');expect(evidenceAge(2000,1000)).toContain('future');expect(evidenceAge(0,120000)).toBe('2m old');
 });
});
