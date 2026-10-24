import {it,expect} from 'vitest';
import {selectContestCandidate,replayContestCell,type ContestCellV1,type ContestInterval,type CapitalContestManifestV1} from '@coqui/core';
import {contestFixture} from './helpers/capital-contest.js';
import {REPLAY_DAY as DAY} from './helpers/capital-replay.js';
it('can choose one evidence-qualified development candidate, while each missing gate still yields none',()=>{
 const {manifest:base,data}=contestFixture(2),template=replayContestCell(base,data,base.trials[0]!);
 const contrasts=[...base.contrasts,{...base.contrasts[0]!,id:'trend-exposure',right:'XT'},{...base.contrasts[1]!,id:'rotation-exposure',right:'XR'}];
 const m:CapitalContestManifestV1={...base,contrasts,trialHistory:{state:'complete',registryHash:null,count:8,sharpeTrials:[0,1],evidenceRefs:['explicit_synthetic_registry']},replay:{...base.replay,toMs:base.replay.fromMs+365*DAY},folds:[{...base.folds[0]!,validationToMs:base.replay.fromMs+365*DAY}]};
 const cells:ContestCellV1[]=m.trials.map(t=>{let nav=100;const points=Array.from({length:366},(_,i)=>{if(i)nav*=1+(t.armId==='T1'?0.001+(i%2?0.0001:-0.0001):t.armId==='R1'?-0.001+(i%2?0.0001:-0.0001):0.0001);return {valuationId:String(i),atMs:m.replay.fromMs+i*DAY,equityUsd:String(nav),unitNavUsd:String(nav),returnPct:null,drawdownPct:null};});
  const good={state:'available' as const,value:'0',method:'synthetic_oracle',evidenceRefs:['fixture']};return {...template,trial:t,result:{...template.result,state:'complete',cell:{...template.result.cell,id:t.id,capitalUsd:t.capitalUsd},summary:{...template.result.summary,executedFills:40},metrics:{...template.result.metrics,maxDrawdownPct:{...good,value:'-1'},...Object.fromEntries(m.selection.rollingDays.map(d=>[`worstRolling${d}ReturnPct`,{...good,value:'-1'}]))},totalPerformance:[{...template.result.totalPerformance[0]!,points}]}};});
 const intervals:ContestInterval[]=contrasts.map(c=>({id:c.id,estimate:{status:'available',value:c.left==='T1'?2:-2},lower:c.left==='T1'?1:-3,upper:c.left==='T1'?3:-1,reasons:[],method:'paired-bonferroni-basic-bootstrap-v1',familySize:4,resamples:3200}));
 expect(selectContestCandidate(m,cells,intervals).candidateId).toBe('T1');
 expect(selectContestCandidate(m,cells.slice(1),intervals).status).toBe('none');
 expect(selectContestCandidate({...m,trialHistory:{...m.trialHistory,state:'known-lower-bound'}},cells,intervals).status).toBe('none');
 expect(selectContestCandidate(m,cells,intervals.map(i=>({...i,lower:null}))).status).toBe('none');
});
