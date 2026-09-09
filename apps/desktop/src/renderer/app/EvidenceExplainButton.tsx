import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { ChannelRequest,ChannelResponse,CoquiClient } from '@coqui/contracts';

type Subject=ChannelRequest<'advisor.evidence.explain'>['subject'];

export function EvidenceExplainButton({client,subject,label='Ask Coqui why'}:{readonly client:CoquiClient;
  readonly subject:Subject;readonly label?:string}):React.JSX.Element {
  const [answer,setAnswer]=useState<ChannelResponse<'advisor.evidence.explain'>|null>(null);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState<string|null>(null);
  const explain=async()=>{setBusy(true);setFailure(null);const result=await client.query('advisor.evidence.explain',{
    commandId:crypto.randomUUID(),subject,provider:null});
    if(result.status==='ok') setAnswer(result.value); else setFailure(result.issues[0]?.code??'explanation_unavailable');setBusy(false);};
  return <div className="context-explanation"><button type="button" aria-expanded={answer!==null} disabled={busy}
    onClick={()=>void explain()}><Sparkles size={14} aria-hidden="true" />{busy?'Reading evidence…':label}</button>
    {answer!==null&&<article aria-live="polite"><p>{answer.text}</p><small>Evidence {answer.evidenceHash.slice(0,12)}… · local deterministic · no execution authority</small></article>}
    {failure!==null&&<small role="alert">Explanation unavailable: {failure.replaceAll('_',' ')}</small>}</div>;
}
