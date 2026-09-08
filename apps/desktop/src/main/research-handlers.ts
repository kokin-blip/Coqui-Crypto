import type { Clock } from '@coqui/core';
import { ResearchHostCoordinator } from '@coqui/services';

import type { ChannelHandlers } from './dispatch.js';

export function createResearchOrchestrationHandlers(input:{readonly coordinator:ResearchHostCoordinator;readonly clock:Clock}):ChannelHandlers {
  return {
    'research.trigger-status':(payload:{readonly triggerId:string})=>{
      const value=input.coordinator.status(payload.triggerId);
      return value===null?{ok:false,issues:[{path:['triggerId'],code:'research_trigger_not_found'}]}:
        {ok:true,value:{triggerId:value.id,family:value.family,kind:value.kind,registered:value.registered,
          trialsUsed:value.trialsUsed,trialBudget:value.trialBudget,lastTriggeredAtMs:value.lastTriggeredAt,
          pendingSinceMs:value.pendingSince,updatedAtMs:value.updatedAt}};
    },
    'research.candidate.review':(payload:{readonly commandId:string;readonly candidateId:string;
      readonly action:'reviewed'|'approved'|'rejected';readonly note:string;readonly actor:string})=>{
      try {
        const result=input.coordinator.review(payload.candidateId,payload.action,payload.note,payload.actor,input.clock.nowMs());
        return {ok:true,value:{eventId:result.event.id,action:result.event.action,atMs:result.event.at,
          championCandidateId:result.champion?.candidateId??null,fencingGeneration:result.champion?.fencingGeneration??null}};
      } catch { return {ok:false,issues:[{path:['candidateId'],code:'research_candidate_review_rejected'}]}; }
    },
    'research.candidate.rollback':(payload:{readonly commandId:string;readonly candidateId:string;
      readonly note:string;readonly actor:string})=>{
      try {
        const result=input.coordinator.rollback(payload.candidateId,payload.note,payload.actor,input.clock.nowMs());
        return {ok:true,value:{eventId:result.event.id,action:'rollback' as const,atMs:result.event.at,
          championCandidateId:result.champion.candidateId,fencingGeneration:result.champion.fencingGeneration}};
      } catch { return {ok:false,issues:[{path:['candidateId'],code:'research_candidate_rollback_rejected'}]}; }
    },
  };
}
