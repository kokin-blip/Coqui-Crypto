import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice } from './TerminalPrimitives.js';
import { DecisionEvidencePanel } from './DecisionEvidencePanel.js';

export function JournalDecisionEvidence({client,decisionId,revision,profileId,id,onClose}:{readonly client:CoquiClient;
  readonly decisionId:string;readonly revision:string;readonly profileId:string;readonly id:string;readonly onClose:()=>void}):React.JSX.Element {
  const queries=useQueryClient();
  const state=useChannel(client,'decision.detail',{decisionId},true,profileId);
  useEffect(()=>{void queries.invalidateQueries({queryKey:['decision.detail',{decisionId},profileId]});},[queries,decisionId,revision,profileId]);
  return state.kind==='ready'?<DecisionEvidencePanel client={client} detail={state.value} id={id} onClose={onClose}/>:<ChannelNotice state={state} label="Decision evidence"/>;
}
