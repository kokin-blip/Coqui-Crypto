import { useCommand } from '../query/use-command.js';
import type { CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice } from './TerminalPrimitives.js';
export function RecoverySettings({client}:{readonly client:CoquiClient}): React.JSX.Element {
  const exportEvidence = useCommand(client,'app.evidence-export');
  const about = useChannel(client,'app.about',{});
  return <section className="settings-section"><h3>Installed build and recovery</h3><ChannelNotice state={about} label="Build identity" />
    {about.kind === 'ready' && <><p>Schema {about.value.schemaVersion} · supported {about.value.supportedSchemaVersion} · live execution disabled · publication {about.value.publication}</p>
      {about.value.build ? <dl className="settings-readout"><div><dt>Version / channel</dt><dd>{about.value.build.version} / {about.value.build.channel}</dd></div>
        <div><dt>Source revision</dt><dd className="mono">{about.value.build.sourceRevision}{about.value.build.dirty ? ' + local changes' : ''}</dd></div>
        <div><dt>Source manifest</dt><dd className="mono">{about.value.build.sourceHash}</dd></div></dl> : <p>Build metadata unknown. Rebuild or verify the installed artifact before relying on source identity.</p>}</>}
    <p>Restore proof: not certified for this profile. Preserve its SQLite databases, profile/person/nickname metadata and referenced external archives/reports. OS credentials are excluded from database backups.</p>
    <p>Use an isolated disposable destination and a compatible executable. Never overwrite the source or open a newer schema with an older executable. Consult the bundled installation/recovery instructions before recovery.</p>
    <p>Export always includes build metadata. Report/decision/outcome summaries and hashes require recorded, unexpired permission for that exact artifact and profile; otherwise they are omitted. Article content, accounts, paths and sealed outcomes are excluded. External gates stay open.</p>
    <button type="button" className="button-secondary" disabled={exportEvidence.state.kind==='pending'} onClick={()=>void exportEvidence.run({commandId:crypto.randomUUID()})}>Export redacted evidence</button>
    {exportEvidence.value && <p role="status">Export {exportEvidence.value.status} · {exportEvidence.value.bundleHash.slice(0,16)}…</p>}
    {['failed','blocked','unknown'].includes(exportEvidence.state.kind) && <p role="alert">Export was not confirmed. Check the destination before retrying.</p>}
    <a href="#/operations">Inspect durable recovery and safety evidence</a>
  </section>;
}
