import { useCommand } from '../query/use-command.js';
import { useState } from 'react';
import type { CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice } from './TerminalPrimitives.js';
export function RecoverySettings({client}:{readonly client:CoquiClient}): React.JSX.Element {
  const exportEvidence = useCommand(client,'app.evidence-export');
  const location = useCommand(client,'news.report.select-location',['news.report']);
  const verify = useCommand(client,'app.recovery.verify');
  const [reportHash,setReportHash] = useState('');
  const [databaseHash,setDatabaseHash] = useState('');
  const [lesson,setLesson] = useState('refused');
  const about = useChannel(client,'app.about',{});
  return <section className="settings-section"><h3>Installed build and recovery</h3><ChannelNotice state={about} label="Build identity" />
    {about.kind === 'ready' && <><p>Schema {about.value.schemaVersion} · supported {about.value.supportedSchemaVersion} · live execution disabled · publication {about.value.publication}</p>
      {about.value.build ? <dl className="settings-readout"><div><dt>Version / channel</dt><dd>{about.value.build.version} / {about.value.build.channel}</dd></div>
        <div><dt>Source revision</dt><dd className="mono">{about.value.build.sourceRevision}{about.value.build.dirty ? ' + local changes' : ''}</dd></div>
        <div><dt>Source manifest</dt><dd className="mono">{about.value.build.sourceHash}</dd></div></dl> : <p>Build metadata unknown. Rebuild or verify the installed artifact before relying on source identity.</p>}</>}
    <p>Restore proof: not certified for this profile. Preserve its SQLite databases, profile/person/nickname metadata and referenced external archives/reports. OS credentials are excluded from database backups.</p>
    <p>Use an isolated disposable destination and a compatible executable. Never overwrite the source or open a newer schema with an older executable. Consult the bundled installation/recovery instructions before recovery.</p>
    <fieldset className="recovery-artifact-fields"><legend>Verify a selected backup in isolation</legend>
      <p>Included: the selected consistent SQLite backup, exact ledger balance and immutable research-event integrity. Excluded: credentials, profile/person/nickname metadata, archives, reports, broker operation and application restart. This proof does not certify a complete profile restore.</p>
      <label htmlFor="recovery-database-hash">Expected backup SHA-256 from your preserved inventory</label>
      <input type="text" className="field-control" id="recovery-database-hash" value={databaseHash} onChange={event=>setDatabaseHash(event.target.value.trim())} autoComplete="off" spellCheck={false} />
      <button type="button" className="button-secondary" disabled={!/^[a-f0-9]{64}$/u.test(databaseHash)||['pending','unknown'].includes(verify.state.kind)}
        onClick={()=>void verify.run({commandId:crypto.randomUUID(),expectedDatabaseHash:databaseHash})}>Choose backup and isolated destination</button>
      {verify.value && <p role="status">{verify.value.status==='cancelled'?'Verification cancelled; no proof recorded.':`Database copy verified. Schema ${verify.value.proof?.schemaVersion}; ledger rows ${verify.value.proof?.ledgerRows}; proof ${verify.value.proof?.proofHash}. External artifacts and restart remain unverified.`}</p>}
      {['failed','blocked','unknown'].includes(verify.state.kind)&&<p role="alert">{verify.state.kind==='unknown'?'Completion is uncertain. Inspect the destination before taking further action.':'Verification refused or failed. Check the backup hash, schema and isolated destination. No recovery success is claimed.'}</p>}
    </fieldset>
    <fieldset className="recovery-artifact-fields"><legend>Locate an already-associated report</legend>
      <p>Select the copied report using its preserved content hash. The report must already belong to this profile. Original associations and location history are retained. An invalid selected file stays unavailable.</p>
      <label htmlFor="recovery-report-hash">Expected report content hash</label>
      <input type="text" className="field-control" id="recovery-report-hash" value={reportHash} onChange={event=>setReportHash(event.target.value.trim())} autoComplete="off" spellCheck={false} />
      <button type="button" className="button-secondary" disabled={!/^[a-f0-9]{64}$/u.test(reportHash)||['pending','unknown'].includes(location.state.kind)}
        onClick={()=>void location.run({commandId:crypto.randomUUID(),reportHash})}>Choose copied report</button>
      {location.value&&<p role="status">{location.value.status==='recorded'?'Verified location recorded.':location.value.status==='already_selected'?'This location was already selected and has been verified again.':'File selection cancelled; location unchanged.'}</p>}
      {['failed','blocked','unknown'].includes(location.state.kind)&&<p role="alert">{location.state.kind==='unknown'?'Location completion is uncertain. Inspect report evidence before retrying.':'Location refused. Check the expected hash, profile association and report compatibility.'}</p>}
    </fieldset>
    <details><summary>Disposable learning walkthrough · simulated only</summary>
      <p>This walkthrough changes explanatory text only. It creates no commands, operational evidence or recovery certification.</p>
      <label htmlFor="recovery-lesson">Explore a simulated state</label>
      <select className="field-control" id="recovery-lesson" value={lesson} onChange={event=>setLesson(event.target.value)}>
        <option value="refused">Refused command</option><option value="unknown">Uncertain completion</option>
        <option value="paused">Paused execution</option><option value="recovered">Safe recovery</option>
      </select>
      <p role="status">Simulated: {lesson==='refused'?'A guard refused the command. Inspect its reason and correct the evidence before issuing a new command.':lesson==='unknown'?'The reply was lost. Completion is unknown; inspect durable evidence rather than submitting again.':lesson==='paused'?'Execution remains paused while reconciliation is uncertain. A passing check does not automatically resume execution.':'Verify a copy in isolation, inspect proof scope, then review unresolved gates. Resume requires a separate explicit operator action.'}</p>
    </details>
    <p>Export always includes build metadata. Report/decision/outcome summaries and hashes require recorded, unexpired permission for that exact artifact and profile; otherwise they are omitted. Article content, accounts, paths and sealed outcomes are excluded. External gates stay open.</p>
    <button type="button" className="button-secondary" disabled={exportEvidence.state.kind==='pending'} onClick={()=>void exportEvidence.run({commandId:crypto.randomUUID()})}>Export redacted evidence</button>
    {exportEvidence.value && <p role="status">Export {exportEvidence.value.status} · {exportEvidence.value.bundleHash.slice(0,16)}…</p>}
    {['failed','blocked','unknown'].includes(exportEvidence.state.kind) && <p role="alert">Export was not confirmed. Check the destination before retrying.</p>}
    <a href="#/operations">Inspect durable recovery and safety evidence</a>
  </section>;
}
