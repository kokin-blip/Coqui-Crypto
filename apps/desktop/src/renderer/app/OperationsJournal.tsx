import { useRef,useState } from 'react';
import type { ChannelResponse,CoquiClient } from '@coqui/contracts';
import { ChevronDown,ChevronRight,Pause,Play,Maximize2,Minimize2 } from 'lucide-react';
import { useChannel } from '../query/use-channel.js';
import { CoquiBadge,CoquiButton,CoquiPanel,CoquiSelect } from './CoquiComponents.js';
import { JournalDecisionEvidence } from './JournalDecisionEvidence.js';
import { CrewRobot } from './CrewRobot.js';
import { ChannelNotice } from './TerminalPrimitives.js';
import { SurfaceState } from './SurfaceState.js';
import { exactUtcTimestamp,formatLocalTimestamp } from './time-format.js';
import { useOperationsJournal,type JournalWorker } from './use-operations-journal.js';

const CREW:Readonly<Record<JournalWorker,string>>={host:'Coqui',market:'Scout',risk:'Guard',research:'Darwin',execution:'Courier',advisor:'Advisor'};
const SOURCES={paper_ledger:'Standard paper',exploratory:'Exploratory paper',parallel:'Parallel paper',research:'Research',advisor:'Advisor',host:'Host',market:'Market'};
const statusLabel=(status:string)=>status==='unknown'?'Current state unconfirmed':status.replaceAll('_',' ');
const tone=(status:string)=>status==='failed'?'danger' as const:status==='blocked'||status==='unknown'?'warning' as const:
  status==='completed'?'success' as const:'neutral' as const;
type Entry=ChannelResponse<'operations.journal.group'>['entries'][number];

function JournalEntry({entry,client,profileId,revision}:{readonly entry:Entry;readonly client:CoquiClient;
  readonly profileId:string;readonly revision:string}):React.JSX.Element {
  const [inspecting,setInspecting]=useState(false);
  const decisionId=typeof entry.facts.decisionId==='string'&&/^[a-f0-9]{64}$/u.test(entry.facts.decisionId)?entry.facts.decisionId:
    entry.groupId.startsWith('decision:')?entry.groupId.slice(9):null;
  return <li className="crew-journal-entry">
    <CrewRobot role={entry.worker} state={entry.status==='running'?'active':entry.status==='failed'||entry.status==='blocked'?'attention':'nominal'} className="crew-journal-avatar"/>
    <div><div className="crew-journal-byline"><strong>{CREW[entry.worker]}</strong><time dateTime={exactUtcTimestamp(entry.atMs)} title={exactUtcTimestamp(entry.atMs)}>{formatLocalTimestamp(entry.atMs)}</time>
      {entry.scope==='global'&&<span>Global research</span>}</div><p>{entry.message}</p>
      <details className="crew-journal-evidence"><summary>Technical details</summary>
        <dl><div><dt>Recorded state</dt><dd>{statusLabel(entry.status)}</dd></div><div><dt>Source</dt><dd>{SOURCES[entry.source]} · {entry.scope}</dd></div>
          <div><dt>Record</dt><dd>{entry.id}</dd></div><div><dt>Attempt</dt><dd>{entry.attemptId}</dd></div>
          {entry.contentHash!==null&&<div><dt>Evidence hash</dt><dd>{entry.contentHash}</dd></div>}
          {Object.entries(entry.facts).filter(([,value])=>value!==null).map(([key,value])=><div key={key}><dt>{key.replace(/([A-Z])/gu,' $1').toLowerCase()}</dt><dd>{String(value)}</dd></div>)}
        </dl>
        {decisionId!==null&&<CoquiButton aria-expanded={inspecting} onClick={()=>setInspecting(v=>!v)}>Inspect decision</CoquiButton>}
        {inspecting&&decisionId!==null&&<JournalDecisionEvidence client={client} decisionId={decisionId} profileId={profileId}
          revision={revision} id={`journal-evidence-${entry.id}`} onClose={()=>setInspecting(false)}/>}
      </details>
    </div>
  </li>;
}
function Journal({client,profileId}:{readonly client:CoquiClient;readonly profileId:string}):React.JSX.Element {
  const journal=useOperationsJournal(client,profileId),scroll=useRef<HTMLDivElement>(null);
  const [expanded,setExpanded]=useState(false);
  const jumpToLatest=()=>{
    journal.jump();
    if(scroll.current!==null){scroll.current.scrollTop=0;scroll.current.focus({preventScroll:true});}
  };
  const detail=journal.detail?.group.id===journal.chosen?journal.detail:null;
  const display=journal.view;
  return <CoquiPanel title="Crew Journal" headingId="crew-journal-heading" controls={<div className="crew-journal-controls">
    {display!==null&&<time className="crew-journal-read" dateTime={exactUtcTimestamp(display.asOfMs)}>Read {formatLocalTimestamp(display.asOfMs)}</time>}
    <CoquiButton aria-expanded={!journal.collapsed} aria-controls="crew-journal-body" onClick={()=>journal.setCollapsed(v=>!v)}>
      {journal.collapsed?<ChevronRight size={14} aria-hidden="true"/>:<ChevronDown size={14} aria-hidden="true"/>}{journal.collapsed?'Show journal':'Collapse'}</CoquiButton>
  </div>}>
    {!journal.collapsed&&<div id="crew-journal-body">
      <div className="terminal-table-toolbar crew-journal-toolbar"><label htmlFor="crew-journal-worker">Show<CoquiSelect id="crew-journal-worker" value={journal.worker??''}
        onChange={event=>journal.changeWorker(event.target.value===''?null:event.target.value as JournalWorker)}>
        <option value="">All crew</option>{Object.entries(CREW).map(([key,name])=><option key={key} value={key}>{name}</option>)}</CoquiSelect></label>
        <CoquiButton aria-pressed={journal.paused} onClick={()=>journal.paused?jumpToLatest():journal.setPaused(true)}>
          {journal.paused?<Play size={14} aria-hidden="true"/>:<Pause size={14} aria-hidden="true"/>}{journal.paused?'Resume updates':'Pause updates'}</CoquiButton>
        <CoquiButton aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?<Minimize2 size={14} aria-hidden="true"/>:<Maximize2 size={14} aria-hidden="true"/>}{expanded?'Compact view':'Expand view'}</CoquiButton>
        <span>{journal.paused?'Display paused · work continues':journal.held?'Reading history':'Recorded worker activity'}</span>
      </div>
      <div className="crew-journal-announcement" aria-live="polite" aria-atomic="true">
        {journal.newActivity&&<><span>New activity available</span><CoquiButton onClick={jumpToLatest}>Jump to latest</CoquiButton></>}
      </div>
      <ChannelNotice state={journal.feed} label="Crew journal"/>
      <div ref={scroll} className={`crew-journal-scroll${expanded?' crew-journal-expanded':''}`} role="region" aria-label="Grouped worker handoffs" tabIndex={0}
        onScroll={()=>{const el=scroll.current;if(el!==null&&el.scrollTop>8)journal.setHeld(true);}}
        onFocusCapture={event=>{if(event.target instanceof Element&&event.target.closest('.crew-journal-evidence')!==null)journal.setHeld(true);}}
        onPointerUp={()=>{if(window.getSelection()?.toString())journal.setHeld(true);}}>
        {display!==null&&display.groups.length===0&&<SurfaceState compact kind="empty" title={journal.worker===null?'Waiting for the next recorded update':'No recorded updates for this worker'}
          detail="Worker messages appear when real operations record evidence."/>}
        {display?.groups.map(group=><article className="crew-journal-group" key={group.id}>
          <h3><button type="button" className="crew-journal-group-trigger" aria-expanded={journal.chosen===group.id} aria-controls={`journal-${group.id}`}
            onClick={()=>journal.select(group.id)}>{journal.chosen===group.id?<ChevronDown size={14} aria-hidden="true"/>:<ChevronRight size={14} aria-hidden="true"/>}
            <span>{group.label}<small>{SOURCES[group.source]}{group.scope==='global'?' · Global research':''} · {formatLocalTimestamp(group.startedAtMs)} — {formatLocalTimestamp(group.updatedAtMs)}</small></span>
            <CoquiBadge tone={tone(group.status)}>{statusLabel(group.status)}</CoquiBadge></button></h3>
          {journal.chosen===group.id&&<div id={`journal-${group.id}`}>
            <ChannelNotice state={journal.group} label="Handoff evidence"/>
            {detail!==null&&<>{detail.nextCursor!==null&&<CoquiButton disabled={detail.entries.length>=200} onClick={journal.olderEntries}>Load older entries</CoquiButton>}
              {!detail.historyComplete&&<p className="crew-journal-note">Showing a bounded history. Earlier entries may be available.</p>}
              <ol className="crew-journal-entries">{detail.entries.map(entry=><JournalEntry key={entry.id} entry={entry} client={client} profileId={profileId} revision={detail.revision}/>)}</ol>
              {detail.entries.length===0&&<p className="crew-journal-note">No matching worker entries in this group.</p>}
            </>}
          </div>}
        </article>)}
      </div>
      {display!==null&&<footer className="crew-journal-footer"><span>Updates reflect recorded work.</span>
        {display.nextCursor!==null&&<CoquiButton disabled={display.groups.length>=20} onClick={journal.olderGroups}>Load older groups</CoquiButton>}
        <details><summary>Activity coverage</summary><ul>{display.coverage.map(item=><li key={item.worker}>{CREW[item.worker]} · {item.lastAtMs===null?'No recorded activity':`Last recorded ${formatLocalTimestamp(item.lastAtMs)}`}</li>)}</ul></details>
      </footer>}
    </div>}
  </CoquiPanel>;
}
export function OperationsJournal({client}:{readonly client:CoquiClient}):React.JSX.Element {
  const profiles=useChannel(client,'accounts.profiles',{});
  if(profiles.kind!=='ready')return <ChannelNotice state={profiles} label="Journal profile"/>;
  return <Journal key={profiles.value.activeProfile.id} profileId={profiles.value.activeProfile.id} client={client}/>;
}
