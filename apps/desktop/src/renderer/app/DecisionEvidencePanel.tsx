import type { RefCallback } from 'react';
import type { ChannelResponse,CoquiClient } from '@coqui/contracts';
import { WalletAttribution } from './WalletNames.js';
import { formatLocalTimestamp } from './time-format.js';
const eventTime=formatLocalTimestamp;
export function DecisionEvidencePanel({client,detail,onClose,headingRef,id='decision-detail'}:{readonly client:CoquiClient;
  readonly detail:ChannelResponse<'decision.detail'>;readonly onClose:()=>void;readonly headingRef?:RefCallback<HTMLHeadingElement>;
  readonly id?:string}):React.JSX.Element {
  const gateReasons = detail.events.flatMap((item) => item.event.kind === 'risk_evaluated' && !item.event.detail.approved
    ? item.event.detail.reasonCodes : []).filter((reason) => reason !== 'gates_refused') ?? [];
  const refusalReasons = detail.events.flatMap((item) => item.event.kind === 'execution_refused' &&
    item.event.detail.reasonCode !== 'gates_refused' ? [item.event.detail.reasonCode] : []) ?? [];
  return (<aside id={id} className="activity-explanation activity-decision-detail" aria-labelledby={`${id}-heading`}>
        <div className="panel-heading"><div><p className="eyebrow">Historical as-of evidence</p>
          <h3 id={`${id}-heading`} ref={headingRef} tabIndex={-1}>Decision detail</h3></div>
          <button type="button" className="button-secondary" onClick={onClose}>Close</button></div>
        {gateReasons.length > 0 && <div className="decision-gate-reasons"><strong>Recorded gate reasons</strong><ul>{gateReasons.map((reason, index) => <li key={`${reason}:${index}`}>{reason.replaceAll('_', ' ')}</li>)}</ul></div>}
        {refusalReasons.length > 0 && <div className="decision-gate-reasons"><strong>Recorded refusal codes</strong><ul>{refusalReasons.map((reason, index) => <li key={`${reason}:${index}`}>{reason.replaceAll('_', ' ')}</li>)}</ul></div>}
        {gateReasons.length === 0 && refusalReasons.length === 0 && detail.events.some((item) => item.event.kind === 'execution_refused') && <p className="metric-note">The persisted record contains a general refusal; no specific failed gate is available in this decision detail.</p>}
        <dl className="evidence-grid">
          <div><dt>Strategy</dt><dd>{detail.decision.strategy.version}</dd></div>
          <div><dt>Completed market interval</dt><dd>{detail.decision.market.asOfMs === null
            ? 'Unavailable' : eventTime(detail.decision.market.asOfMs)}</dd></div>
          <div><dt>History</dt><dd>{detail.decision.historyStatus}</dd></div>
          <div><dt>Exposure / cash</dt><dd>{detail.decision.exposure ?? 'Unavailable'} / {detail.decision.cashWeight ?? 'Unavailable'}</dd></div>
          <div><dt>Assets</dt><dd>{detail.assetScopes.join(', ')}</dd></div>
          <div><dt>Evidence / routes</dt><dd>{detail.events.length} / {detail.routes.length}</dd></div>
        </dl>
        {detail.routes.length===0?<p className="empty-state">No execution route was recorded for this decision.</p>:
          <ol className="execution-route-grid">{detail.routes.map((route)=><li key={route.routeId}>
            <header><strong>{route.side.toUpperCase()} {route.exposureKey}</strong><span>{route.provider.replace('_',' ')}</span></header>
            <dl><div><dt>Paper notional</dt><dd>{route.amountUsd} USD</dd></div><div><dt>Instrument</dt><dd>{route.productId}</dd></div>
              <div><dt>Connection</dt><dd title={route.connectionId}><WalletAttribution client={client} connectionId={route.connectionId} /></dd></div>
              <div><dt>Assumptions</dt><dd title={route.assumptionHash}>{route.assumptionHash.slice(0,12)}…</dd></div></dl>
            <small>Fee, spread, liquidity, permission, and minimum evidence: unavailable in this bounded read model.</small>
          </li>)}</ol>}
        <p className="metric-note">Decision {detail.decision.decisionId} · hash {detail.decisionHash}</p>
        <ol className="activity-feed">{detail.events.map((item) => <li key={item.eventId}>
          <span className="event-marker status-info" aria-hidden="true" /><div>
            <strong>{item.event.kind.replaceAll('_', ' ')}</strong>
            <p>{item.event.kind === 'risk_evaluated' ? item.event.detail.approved ? 'Risk evaluation approved.' :
              item.event.detail.reasonCodes.length > 0 ? `Refused: ${item.event.detail.reasonCodes.map((code) => code.replaceAll('_', ' ')).join(', ')}` : 'Risk evaluation refused; no specific reason recorded.' :
              item.event.kind === 'no_trade' || item.event.kind === 'stand_down' || item.event.kind === 'execution_refused'
                ? item.event.detail.reasonCode.replaceAll('_', ' ') : 'Recorded immutable evidence.'}</p>
            <small>{eventTime(item.event.atMs)} · {item.payloadHash.slice(0, 12)}…</small>
          </div></li>)}</ol>
      </aside>);
}
