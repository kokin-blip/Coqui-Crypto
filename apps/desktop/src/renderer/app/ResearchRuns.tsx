import type { CoquiClient } from '@coqui/contracts';
import { useEffect,useRef,useState } from 'react';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { EvidenceExplainButton } from './EvidenceExplainButton.js';
import { takeAdvisorSelection } from './advisor-navigation.js';

const INVALIDATIONS=['research.lineage','research.jobs'] as const;

function CandidateReviewControls({client,candidate}:{readonly client:CoquiClient;readonly candidate:{
  readonly candidateId:string;readonly state:'promotion_eligible'|'rejected';readonly active:boolean}}):React.JSX.Element {
  const [note,setNote]=useState('');
  const review=useCommand(client,'research.candidate.review',INVALIDATIONS);
  const rollback=useCommand(client,'research.candidate.rollback',INVALIDATIONS);
  const busy=review.state.kind==='pending'||rollback.state.kind==='pending', ready=note.trim().length>=3;
  const act=(action:'reviewed'|'approved'|'rejected')=>void review.run({commandId:crypto.randomUUID(),
    candidateId:candidate.candidateId,action,note:note.trim(),actor:'local-user'});
  return <div className="candidate-review-controls">
    <label><span>Human audit note</span><input value={note} maxLength={1000}
      onChange={(event)=>setNote(event.target.value)} placeholder="Record the evidence behind this decision" /></label>
    <div className="candidate-review-actions">
      <button type="button" disabled={busy||!ready} onClick={()=>act('reviewed')}>Review</button>
      {candidate.state==='promotion_eligible'&&!candidate.active&&<button type="button" disabled={busy||!ready} onClick={()=>act('approved')}>Approve</button>}
      {!candidate.active&&<button type="button" disabled={busy||!ready} onClick={()=>act('rejected')}>Reject</button>}
      {!candidate.active&&<button type="button" disabled={busy||!ready} onClick={()=>void rollback.run({commandId:crypto.randomUUID(),
        candidateId:candidate.candidateId,note:note.trim(),actor:'local-user'})}>Roll back to</button>}
    </div>
    {(review.state.kind==='failed'||review.state.kind==='blocked'||rollback.state.kind==='failed'||rollback.state.kind==='blocked')&&
      <small role="alert">The candidate action was refused. Check eligibility and prior activation history.</small>}
  </div>;
}

export function ResearchRuns({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const runs = useChannel(client, 'research.runs', {});
  const lineage = useChannel(client, 'research.lineage', { limit: 50 });
  const selection=useRef<ReturnType<typeof takeAdvisorSelection>|undefined>(undefined);
  if(selection.current===undefined) selection.current=takeAdvisorSelection();
  useEffect(()=>{
    const candidateId=selection.current?.candidateId;
    if(candidateId===null||candidateId===undefined||lineage.kind!=='ready') return;
    document.getElementById(`candidate-${candidateId}`)?.scrollIntoView({block:'center'});
  },[lineage.kind]);
  const emptyResearch = runs.kind === 'ready' && runs.value.length === 0 &&
    lineage.kind === 'ready' && lineage.value.candidates.length === 0;

  return (
    <section aria-labelledby="runs-heading" className="panel space-y-3">
      <div className="panel-heading">
        <div><p className="eyebrow">Immutable evidence</p><h2 id="runs-heading">Registered study runs</h2></div>
      </div>

      {runs.kind === 'loading' && <p aria-live="polite">Loading registered runs…</p>}
      {emptyResearch && <p className="empty-state">No registered run or champion/challenger lineage has been recorded. The host begins durable research jobs after a registered study is started; this view does not create placeholder evidence.</p>}
      {runs.kind === 'ready' && runs.value.length > 0 && (
        <ul className="evidence-list">
          {runs.value.map((run) => (
            <li key={run.runHash}>
              <span><strong>{run.id}</strong> · {run.adopted ? 'adopted' : 'not adopted'}</span>
              <span className="muted">dataset {run.datasetHash.slice(0, 12)}…</span>
            </li>
          ))}
        </ul>
      )}
      {runs.kind !== 'loading' && runs.kind !== 'ready' && (
        <p role="alert">
          {runs.kind === 'blocked' ? 'Blocked' : runs.kind === 'unknown' ? 'Outcome unconfirmed' : 'Could not load runs'}:{' '}
          {runs.issues.map((issue) => issue.code).join(', ')}
        </p>
      )}
      {!emptyResearch && <div className="lineage-heading"><h3>Champion and challenger lineage</h3>
        <span>{lineage.kind === 'ready' ? `as of ${new Date(lineage.value.asOfMs).toISOString().slice(0, 10)} · global` : 'Persisted evidence only'}</span></div>}
      {lineage.kind === 'loading' && <p aria-live="polite">Reading immutable lineage…</p>}
      {lineage.kind === 'ready' && lineage.value.candidates.length === 0 && !emptyResearch &&
        <p className="empty-state">No champion or challenger candidate has been recorded.</p>}
      {lineage.kind === 'ready' && lineage.value.candidates.length > 0 && <ol className="lineage-list">
        {lineage.value.candidates.map((candidate) => <li key={candidate.candidateId} id={`candidate-${candidate.candidateId}`}
          data-active={candidate.active || undefined} data-selected={selection.current?.candidateId===candidate.candidateId||undefined}>
          <div><strong>{candidate.strategyVersion}</strong><span>{candidate.active ? 'active champion' : candidate.state.replaceAll('_', ' ')}</span></div>
          <p>{candidate.parentId === null ? 'Root candidate' : `Child of ${candidate.parentId.slice(0, 10)}…`}</p>
          <small>evidence {candidate.evidenceHash.slice(0, 12)}… · {new Date(candidate.createdAtMs).toISOString()}</small>
          <EvidenceExplainButton client={client} subject={{kind:'research_candidate',id:candidate.candidateId}}
            label={candidate.state==='promotion_eligible'?'Why is this eligible?':'Why was this rejected?'} />
          <CandidateReviewControls client={client} candidate={candidate} />
        </li>)}
      </ol>}
      {lineage.kind !== 'loading' && lineage.kind !== 'ready' &&
        <p role="alert">Lineage unavailable: {lineage.issues.map((issue) => issue.code).join(', ')}</p>}
    </section>
  );
}
