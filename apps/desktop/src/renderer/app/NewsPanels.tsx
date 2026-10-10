import { useState } from 'react';
import type { CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';
export function NewsTimeline({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const timeline = useChannel(client, 'news.timeline', { asOfMs: null, limit: 100 });
  const [selected, setSelected] = useState<string | null>(null);
  return <section className="panel" aria-labelledby="news-heading">
    <div className="panel-heading"><h2 id="news-heading">News intelligence</h2><span>Research context only</span></div>
    <p className="muted">First-page coverage is unknown. Publisher diversity does not establish independent corroboration.</p>
    {timeline.kind === 'loading' && <SurfaceState kind="loading" title="Loading news evidence" compact />}
    {timeline.kind !== 'loading' && timeline.kind !== 'ready' && <SurfaceState kind="error" title="News evidence unavailable" detail="Try reopening Events after the host resumes." compact />}
    {timeline.kind === 'ready' && timeline.value.observations.length === 0 && <SurfaceState kind="empty" title="No retained news for this profile" detail="GDELT collection runs only in Main. Metered providers remain disabled." compact />}
    {timeline.kind === 'ready' && timeline.value.observations.length > 0 && timeline.value.asOfMs - timeline.value.observations[0]!.availableAtMs > 7_200_000 && <p role="status">Retained news is stale: latest availability is over two hours old.</p>}
    {timeline.kind === 'ready' && <ol className="event-workspace-list">{timeline.value.observations.map(o => <li key={o.id}>
      <div><strong>{o.observation.title}</strong><span>{o.observation.provider} · {o.observation.sourceDomain}</span></div>
      <p>{o.observation.description ?? 'No description supplied.'}</p>
      <dl><div><dt>Available</dt><dd>{new Date(o.availableAtMs).toISOString()}</dd></div><div><dt>Published</dt><dd>{o.observation.publishedAtMs === null ? 'Unknown' : new Date(o.observation.publishedAtMs).toISOString()}</dd></div></dl>
      <button type="button" className="button-secondary" aria-expanded={selected === o.id} onClick={() => setSelected(selected === o.id ? null : o.id)}>Inspect news evidence</button>
      {selected === o.id && <NewsDetail client={client} observationId={o.id} />}
    </li>)}</ol>}
    <p className="settings-help">GDELT Project · https://www.gdeltproject.org/ · headlines and metadata only</p>
  </section>;
}
function NewsDetail({ client, observationId }: { readonly client: CoquiClient; readonly observationId: string }): React.JSX.Element {
  const detail = useChannel(client, 'news.detail', { observationId, asOfMs: null });
  if (detail.kind !== 'ready') return <SurfaceState kind={detail.kind === 'loading' ? 'loading' : 'error'} title={detail.kind === 'loading' ? 'Loading analysis' : 'Analysis unavailable'} compact />;
  const analysis = detail.value.analyses[0];
  if (!analysis) return <p>No completed analysis is available for this observation.</p>;
  return <div><p>Event: {analysis.eventLabel.replaceAll('_', ' ')} · observation {analysis.observationId}</p>
    <ul>{analysis.instruments.map(i => <li key={i.asset}>{i.instrument.productId}: tone {i.sentimentScore === null ? 'unknown' : i.sentimentScore} · {i.sentimentReason.replaceAll('_', ' ')}
      {i.providerEntities.map(p => <p key={p.index}>Provider candidate {p.index}: sentiment {p.entity.sentimentScore ?? 'missing'} · match {p.entity.matchScore ?? 'missing'}</p>)}</li>)}</ul>
    <ul>{analysis.resolutions.filter(r => r.status === 'unresolved').map((r, index) => <li key={index}>{r.candidate}: unresolved · {r.reason.replaceAll('_', ' ')}</li>)}</ul>
    <p>Provider sentiment is retained separately. Tone scores are directional indicators.</p>
    {detail.value.features.map(f => <p key={f.id}>{f.cadence} feature available {new Date(f.availableAtMs).toISOString()} · {f.windows[1]?.groupCount ?? 0} groups · {f.windows[1]?.publisherCount ?? 0} publisher hosts · {f.featureVersion}</p>)}
  </div>;
}
export function NewsHealth({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const health = useChannel(client, 'news.health', {});
  const toggle = useCommand(client, 'news.analysis.set-enabled', ['news.health']);
  if (health.kind !== 'ready') return <SurfaceState kind={health.kind === 'loading' ? 'loading' : 'error'} title={health.kind === 'loading' ? 'Loading news provider health' : 'News provider health unavailable'} compact />;
  const value = health.value;
  return <section className="settings-section" aria-labelledby="news-health-heading"><h3 id="news-health-heading">News providers and analysis</h3>
    <p>{value.mainProfile ? 'Main profile' : 'Inactive collection profile'} · coverage unknown · counts cover the trailing 24 hours</p>
    <dl className="settings-readout">{value.providers.map(p => <div key={p.provider}><dt>{p.provider}</dt><dd>{p.enabled ? 'Scheduled' : 'Disabled'} · {p.succeeded} transport successes · {p.failed} failed · {p.pending} pending · last completion {p.lastCompletedAtMs === null ? 'unknown' : new Date(p.lastCompletedAtMs).toISOString()} · parsed {p.parsed} · retained {p.retained} · new observations {p.inserted} · last useful {p.lastUsefulAtMs === null ? 'unknown' : new Date(p.lastUsefulAtMs).toISOString()} · canonical eligibility {p.canonicalEligibility}{p.latestReason && ` · ${p.latestReason.replaceAll('_', ' ')}`}</dd></div>)}</dl>
    <p>Last completed analysis: {value.latestAnalysisAtMs === null ? 'None' : new Date(value.latestAnalysisAtMs).toISOString()}</p>
    <button type="button" className="button-secondary" disabled={!value.mainProfile || !value.analysisEnabled && !value.mappingReady || toggle.state.kind === 'pending'} onClick={() => void toggle.run({ commandId: crypto.randomUUID(), enabled: !value.analysisEnabled })}>{value.analysisEnabled ? 'Disable scheduled analysis' : 'Enable scheduled analysis'}</button>
    {!value.mappingReady && <p>Install a reviewed mapping configuration through the news analysis command before enabling analysis.</p>}
    {toggle.state.kind === 'failed' && <p role="alert">Analysis setting was not saved. Check Main profile and mapping readiness.</p>}
    <p>Marketaux and Currents remain disabled pending credentials and retention permissions.</p>
  </section>;
}
export function NewsStudyStatus({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const report = useChannel(client, 'news.report', {});
  return <section className="panel"><h2>News research</h2>
    {report.kind !== 'ready' ? <SurfaceState compact kind={report.kind === 'loading' ? 'loading' : 'error'} title="Report association unavailable" /> : <>
      <p>Report association: {report.value.association}. Evaluated does not imply profitability or promotion.</p>
      {report.value.report && <><p className="mono">{report.value.report.reportHash}</p><p>Completed {new Date(report.value.report.completedAtMs).toISOString()}</p>
        <ul>{report.value.report.horizons.map(h => <li key={`${h.cadence}:${h.horizonHours}`}><strong>{h.cadence} {h.horizonHours}h: {h.status.replaceAll('_',' ')}</strong> · {h.prospectiveRows} eligible rows · {h.reasons.join(', ').replaceAll('_',' ')}
          <details><summary>Exact provenance</summary><p>Source {h.codeRevision} · dataset {h.datasetHash} · costs {h.costHash} · manifest {h.manifestHash}</p><p>Archives {h.sourceManifestHashes.join(', ')}</p></details></li>)}</ul></>}
    </>}
    <p>Reconstructed history cannot satisfy prospective evidence requirements. Legacy scalar status has no verified report association.</p>
  </section>;
}
