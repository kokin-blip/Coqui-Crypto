import { FileUp,ShieldCheck } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import type { CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { EvidenceExplainButton } from './EvidenceExplainButton.js';
import { takeAdvisorSelection } from './advisor-navigation.js';

export function Events({client}:{readonly client:CoquiClient}):React.JSX.Element {
  const timeline=useChannel(client,'market-events.timeline',{asOfMs:null,limit:200});
  const ingest=useCommand(client,'market-events.ingest-file',['market-events.timeline','activity.feed']);
  const [sourceId,setSourceId]=useState('local-research');
  const events=timeline.kind==='ready'?timeline.value.events:[];
  const selection=useRef<ReturnType<typeof takeAdvisorSelection>|undefined>(undefined);
  if(selection.current===undefined) selection.current=takeAdvisorSelection();
  useEffect(()=>{
    const eventId=selection.current?.eventId;
    if(eventId===null||eventId===undefined||timeline.kind!=='ready') return;
    requestAnimationFrame(()=>document.getElementById(`event-${eventId}`)?.scrollIntoView({block:'center'}));
  },[events.length]);
  return <div className="screen-stack"><section className="panel events-import" aria-labelledby="events-import-heading">
    <div className="panel-heading"><div><p className="eyebrow">Local evidence only</p><h2 id="events-import-heading">Event dataset</h2></div>
      <span className="data-boundary"><ShieldCheck size={14} aria-hidden="true" /> Target and execution influence disabled</span></div>
    <p>Import a validated JSON fixture. Published time and first-known time remain separate so historical replay cannot see future information.</p>
    <div className="event-import-actions"><label><span>Source identity</span><input value={sourceId} onChange={(event)=>setSourceId(event.target.value.toLowerCase())} /></label>
      <button type="button" className="button-primary" disabled={ingest.state.kind==='pending'||!/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(sourceId)}
        onClick={()=>void ingest.run({commandId:crypto.randomUUID(),sourceId,confirmed:true})}><FileUp size={15} aria-hidden="true" />
        {ingest.state.kind==='pending'?'Validating…':'Choose JSON fixture'}</button></div>
    {ingest.value!==null&&<div role="status"><p>{ingest.value.outcome==='cancelled'?'Import cancelled.':`${ingest.value.results.filter((item)=>item.inserted).length} new events recorded.`}</p>
      {ingest.value.results.flatMap((item)=>item.triggerDecisions).map((trigger)=><div className="event-trigger-result" key={trigger.triggerId}>
        <span>{trigger.triggerId} · {trigger.reasonCode.replaceAll('_',' ')}</span>
        {trigger.jobId!==null&&<EvidenceExplainButton client={client} subject={{kind:'research_trigger',id:trigger.triggerId}}
          label="Explain this registered trigger" />}</div>)}</div>}
  </section><section className="panel" aria-labelledby="events-timeline-heading"><div className="panel-heading"><div><p className="eyebrow">Historical as-of evidence</p><h2 id="events-timeline-heading">Known events</h2></div><span>{events.length} recorded</span></div>
    {timeline.kind==='loading'&&<p aria-live="polite">Loading event evidence…</p>}
    {timeline.kind!=='loading'&&timeline.kind!=='ready'&&<p role="alert">Event evidence is unavailable.</p>}
    {timeline.kind==='ready'&&events.length===0&&<p className="empty-state">No local event fixture has been imported for this profile.</p>}
    {events.length>0&&<ol className="event-workspace-list">{events.map((event)=><li key={event.id} id={`event-${event.id}`}
      data-selected={selection.current?.eventId===event.id||undefined}>
      <div><strong>{event.title}</strong><span>{event.assetSymbols.length===0?'Global':event.assetSymbols.join(', ')}</span></div>
      <p>{event.summary||'No summary was recorded.'}</p><dl><div><dt>Published</dt><dd>{new Date(event.publishedAtMs).toISOString()}</dd></div><div><dt>First known</dt><dd>{new Date(event.firstSeenAtMs).toISOString()}</dd></div><div><dt>Classification</dt><dd>{event.classification===null?'Unavailable at this as-of':`${event.classification.label.replaceAll('_',' ')} · ${event.classification.importance}`}</dd></div></dl>
      <EvidenceExplainButton client={client} subject={{kind:'market_event',id:event.id}} label="Why does this event matter?" />
      <small>Provenance {event.provenanceHash.slice(0,12)}… · context only</small></li>)}</ol>}
  </section></div>;
}
