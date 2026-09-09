import type { ChannelResponse,CoquiClient } from '@coqui/contracts';
import { CHART_COLORS,formatPercent } from '@coqui/ui-kit';
import { FinancialChart,type FinancialChartSeries } from './FinancialChart.js';
import { SurfaceState } from './SurfaceState.js';
import { useChannel } from '../query/use-channel.js';
import { boundedMetricWidth } from './evidence-visualization.js';

type Track=ChannelResponse<'research.scoreboard'>['tracks'][number];
const LABELS:Record<Track['trackId'],string>={selected:'Selected',hold:'Buy and hold',passive:'Passive mix'};
const COLORS=[CHART_COLORS.primary,CHART_COLORS.benchmark,CHART_COLORS.supportingText] as const;

export function ResearchEvidenceDashboard({client}:{readonly client:CoquiClient}):React.JSX.Element {
  const scoreboard=useChannel(client,'research.scoreboard',{});
  const performance=useChannel(client,'research.performance',{});
  const jobs=useChannel(client,'research.jobs',{limit:50});
  const gate=useChannel(client,'risk.evidence-gate',{});
  const tracks=scoreboard.kind==='ready'?scoreboard.value.tracks:[];
  const returns=tracks.map((track)=>track.afterCostReturnPct);
  const curves:FinancialChartSeries[]=performance.kind==='ready'?performance.value.flatMap((run,index)=>
    run.status==='available'&&run.curve.length>0?[{id:run.runHash,label:run.runId,color:COLORS[index%COLORS.length]!,
      values:run.curve.map((point)=>({day:new Date(point.atMs).toISOString().slice(0,10),value:Number(point.equityUsd)}))}]:[]):[];
  return <div className="research-visual-grid">
    <section className="panel research-comparison" aria-labelledby="research-comparison-heading">
      <div className="panel-heading"><div><p className="eyebrow">After-cost comparison</p><h2 id="research-comparison-heading">Candidate versus benchmarks</h2></div></div>
      {scoreboard.kind==='loading'&&<SurfaceState kind="loading" title="Loading verified comparisons" compact />}
      {scoreboard.kind!=='loading'&&scoreboard.kind!=='ready'&&<SurfaceState kind="empty" title="Verified comparison unavailable" detail="No adopted immutable study is available." compact />}
      {tracks.length>0&&<ol className="research-metric-bars">{tracks.map((track)=><li key={track.trackId}>
        <div><strong>{LABELS[track.trackId]}</strong><span>{formatPercent(track.afterCostReturnPct)?.text??'Unavailable'}</span></div>
        <span className="research-metric-track" aria-hidden="true"><i data-negative={track.afterCostReturnPct<0||undefined}
          style={{width:boundedMetricWidth(track.afterCostReturnPct,returns)}} /></span>
        <small>Sortino {track.sortino?.toFixed(2)??'unavailable'} · drawdown {formatPercent(track.maxDrawdownPct)?.text??'unavailable'}</small>
      </li>)}</ol>}
    </section>
    <section className="panel" aria-labelledby="research-curve-heading"><div className="panel-heading"><div><p className="eyebrow">Persisted points only</p><h2 id="research-curve-heading">Champion and challenger equity</h2></div></div>
      {performance.kind==='loading'&&<SurfaceState kind="loading" title="Loading recorded curves" compact />}
      {performance.kind==='ready'&&curves.length===0&&<SurfaceState kind="empty" title="Equity curves unavailable—not recorded" compact />}
      {curves.length>0&&<FinancialChart client={client} filenameStem="coqui-research-equity" series={curves}
        summary={`${curves.length} immutable research equity curve${curves.length===1?'':'s'}.`} />}
    </section>
    <section className="panel" aria-labelledby="worker-progress-heading"><div className="panel-heading"><div><p className="eyebrow">Bounded worker pool</p><h2 id="worker-progress-heading">Worker progress</h2></div></div>
      {jobs.kind==='loading'&&<SurfaceState kind="loading" title="Loading worker evidence" compact />}
      {jobs.kind==='ready'&&jobs.value.length===0&&<SurfaceState kind="empty" title="No worker attempt recorded" compact />}
      {jobs.kind==='ready'&&jobs.value.length>0&&<ol className="worker-progress-list">{jobs.value.map((job)=><li key={job.id} data-state={job.status}>
        <div><strong>{job.kind}</strong><span>{job.status}</span></div><progress aria-label={`${job.kind} job ${job.status}`} max={100} value={job.status==='queued'?15:job.status==='running'?60:100}>{job.status}</progress>
        <small>{job.attemptCount} attempt{job.attemptCount===1?'':'s'} · {job.failureReason.replaceAll('_',' ')}</small></li>)}</ol>}
    </section>
    <section className="panel" aria-labelledby="research-evidence-map-heading"><div className="panel-heading"><div><p className="eyebrow">Evidence availability</p><h2 id="research-evidence-map-heading">Validation map</h2></div></div>
      <dl className="research-availability">
        <div><dt>Walk-forward</dt><dd>{gate.kind==='ready'?gate.value.gates.find((item)=>item.code==='walk_forward')?.met?'Passed':'Not passed':'Unavailable'}</dd></div>
        <div><dt>Significance</dt><dd>{gate.kind==='ready'?gate.value.gates.find((item)=>item.code==='significance')?.met?'Passed':'Not passed':'Unavailable'}</dd></div>
        {['Cost sensitivity curve','Parameter stability','Monte Carlo distribution','Stress series'].map((label)=><div key={label}><dt>{label}</dt><dd>Unavailable—not recorded</dd></div>)}
      </dl><p className="metric-note">Missing artifacts remain missing; this view never derives or simulates replacement points.</p>
    </section>
  </div>;
}
