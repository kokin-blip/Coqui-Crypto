import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { useEffect,useState } from 'react';

import { useChannel } from '../query/use-channel.js';
import { SurfaceState } from './SurfaceState.js';
import { takeAdvisorSelection } from './advisor-navigation.js';
import { boundedRiskMeter } from './evidence-visualization.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';

type RiskView = ChannelResponse<'risk.dashboard'>;
type Rung = RiskView['ladder'][number];

/**
 * The risk ladder, shown but not offered.
 *
 * Every control here is derived from the equity history on each read. Nothing
 * on this screen can change any of it, and that is the point: `CLAUDE.md` §3.5
 * puts guardrails in code, and P8's exit criterion is that the gate cannot be
 * edited or overridden from the UI. There is no write channel behind this
 * screen, which is a stronger guarantee than a disabled control.
 */

const STAGE_LABEL: Record<Rung['stage'], string> = {
  normal: 'NORMAL',
  caution: 'CAUTION',
  defense: 'DEFENSE',
  hard_stop: 'HARD STOP',
};

function percent(value: number | null, digits = 1): string {
  return value === null ? '—' : `${value.toFixed(digits)}%`;
}

function Rung({ rung }: { readonly rung: Rung }): React.JSX.Element {
  return (
    <li className={rung.active ? 'risk-rung active font-semibold' : 'risk-rung opacity-70'}>
      <span className="risk-rung-marker" aria-hidden="true">{rung.active ? 'Current' : ''}</span>
      <strong>{STAGE_LABEL[rung.stage]}</strong>
      <span className="ml-3 font-normal">
        sizing ×{rung.exposureScale}
        {rung.active && <span className="sr-only"> — current stage</span>}
      </span>
      <p className="font-normal opacity-70">{rung.entryCondition}</p>
    </li>
  );
}

export function Risk({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const risk = useChannel(client, 'risk.dashboard', {});
  const timeline=useChannel(client,'decision.timeline',{assetScope:null,asOfMs:null,limit:100});
  const [explanation,setExplanation]=useState<ChannelResponse<'advisor.decision.explain'>|null>(null);
  const [explanationFailure,setExplanationFailure]=useState<string|null>(null);

  useEffect(()=>{
    const decisionId=takeAdvisorSelection()?.decisionId;
    if(decisionId===null||decisionId===undefined) return;
    void client.query('advisor.decision.explain',{commandId:crypto.randomUUID(),decisionId,provider:null})
      .then((result)=>result.status==='ok'?setExplanation(result.value):
        setExplanationFailure(result.issues[0]?.code??'decision_explanation_failed'));
  },[client]);

  if (risk.kind === 'loading') return <SurfaceState kind="loading" title="Loading risk controls" />;

  if (risk.kind !== 'ready') {
    return <SurfaceState kind="error" title="Could not load risk controls" detail={risk.issues.map((issue) => issue.code).join(', ')} />;
  }

  const view = risk.value;

  return (
    <section aria-labelledby="risk-heading" className="risk-workspace">
      <h2 id="risk-heading" className="font-semibold">
        Risk controls
        <span className="ml-3 font-normal opacity-70">
          stage {STAGE_LABEL[view.stage]} · sizing ×{view.exposureScale}
        </span>
      </h2>

      {view.insufficientHistory && (
        // Said outright. A drawdown computed over three observations looks
        // exactly like a measurement, and reads as one.
        <p role="note" className="risk-callout warning">
          <span aria-hidden="true">⚠ </span>
          {view.sampleCount} equity observation{view.sampleCount === 1 ? '' : 's'} — too few for
          these figures to describe anything yet. The ladder still applies; the numbers do not
          mean much.
        </p>
      )}

      {view.blockReason !== null && (
        <p role="alert" className="risk-callout danger">
          <span aria-hidden="true">■ </span>
          Trading halted: {view.blockReason}
        </p>
      )}

      <dl className="risk-summary tabular-nums">
        <div>
          <dt className="opacity-70">drawdown</dt>
          <dd>{percent(view.drawdownPct)}</dd>
        </div>
        <div>
          <dt className="opacity-70">expected shortfall</dt>
          <dd>{percent(view.expectedShortfallPct)}</dd>
        </div>
        <div>
          <dt className="opacity-70">realised vol</dt>
          <dd>{percent(view.realizedVolatilityPct)}</dd>
        </div>
        <div>
          <dt className="opacity-70">forecast vol</dt>
          <dd>{percent(view.forecastVolatilityPct)}</dd>
        </div>
        <div>
          <dt className="opacity-70">max gross exposure</dt>
          <dd>{percent(view.maxGrossExposurePct, 0)}</dd>
        </div>
        <div>
          <dt className="opacity-70">max trades per run</dt>
          <dd>{view.maxTradeCount}</dd>
        </div>
        <div>
          {/* Distinct from price-feed staleness, which this screen cannot
              observe and therefore does not claim. */}
          <dt className="opacity-70">equity history age</dt>
          <dd>
            {view.snapshotAgeMs === null
              ? 'no snapshots'
              : `${Math.floor(view.snapshotAgeMs / 86_400_000)}d`}
          </dd>
        </div>
      </dl>

      <section className="risk-visuals" aria-labelledby="risk-visuals-heading"><div className="panel-heading"><div>
        <p className="eyebrow">Current measured state</p><h3 id="risk-visuals-heading">Exposure, volatility, and drawdown</h3></div></div>
        <div className="risk-meter-grid">
          <label><span>Permitted exposure</span><strong>{percent(view.exposureScale*100)}</strong><progress max={100} value={view.exposureScale*100} /></label>
          <label><span>Drawdown</span><strong>{percent(view.drawdownPct)}</strong><progress max={100} value={boundedRiskMeter(view.drawdownPct)??0} /></label>
          <label><span>Realized volatility</span><strong>{percent(view.realizedVolatilityPct)}</strong>{boundedRiskMeter(view.realizedVolatilityPct)===null?<em>Unavailable</em>:<progress max={100} value={boundedRiskMeter(view.realizedVolatilityPct)!} />}</label>
          <label><span>Forecast volatility</span><strong>{percent(view.forecastVolatilityPct)}</strong>{boundedRiskMeter(view.forecastVolatilityPct)===null?<em>Unavailable</em>:<progress max={100} value={boundedRiskMeter(view.forecastVolatilityPct)!} />}</label>
        </div>
      </section>

      <ul className="risk-ladder">
        {view.ladder.map((rung) => (
          <Rung key={rung.stage} rung={rung} />
        ))}
      </ul>

      <section className="risk-decision-history" aria-labelledby="risk-history-heading"><div className="panel-heading"><div>
        <p className="eyebrow">Immutable decision events</p><h3 id="risk-history-heading">Recent risk evaluations</h3></div></div>
        {timeline.kind==='loading'&&<p aria-live="polite">Loading risk decisions…</p>}
        {timeline.kind==='ready'&&timeline.value.items.filter((item)=>item.kind==='risk_evaluated').length===0&&<p className="empty-state">No historical risk evaluation is recorded.</p>}
        {timeline.kind==='ready'&&<ol>{timeline.value.items.filter((item)=>item.kind==='risk_evaluated').slice(0,12).map((item)=><li key={item.eventId}>
          <span className={`event-marker status-${item.status}`} aria-hidden="true"/><div><strong>{item.status}</strong>
            <time dateTime={exactUtcTimestamp(item.occurredAtMs)} title={exactUtcTimestamp(item.occurredAtMs)}>{formatLocalTimestamp(item.occurredAtMs)}</time>
            <small>decision {item.decisionId.slice(0,12)}… · evidence {item.payloadHash.slice(0,12)}…</small></div></li>)}</ol>}
      </section>

      {view.warnings.length > 0 && (
        <ul className="opacity-70">
          {view.warnings.map((warning) => (
            <li key={warning}>
              <span aria-hidden="true">· </span>
              {warning}
            </li>
          ))}
        </ul>
      )}

      <p className="opacity-70">
        These limits are enforced in code before any order is sized. Nothing on this screen can
        raise or disable them.
      </p>
      {explanation!==null&&<article className="activity-explanation" aria-live="polite"><strong>Selected risk decision</strong>
        <p>{explanation.text}</p><small>Evidence {explanation.evidenceHash.slice(0,12)}… · no execution authority</small></article>}
      {explanationFailure!==null&&<p role="alert">Selected decision unavailable: {explanationFailure.replaceAll('_',' ')}</p>}
    </section>
  );
}
