import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import { SurfaceState } from './SurfaceState.js';
import { applyAdvisorNavigation,takeAdvisorSelection } from './advisor-navigation.js';

type FeedEvent = ChannelResponse<'activity.feed'>['events'][number];
type DecisionExplanation = ChannelResponse<'advisor.decision.explain'>;
type DecisionDetail = ChannelResponse<'decision.detail'>;
type EventFilter = 'all' | FeedEvent['status'];
const FILTERS: readonly EventFilter[] = ['all', 'info', 'pending', 'blocked', 'failed', 'succeeded', 'unknown'];

function eventTime(at: number): string {
  return new Date(at).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

export function Activity({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const [cursor, setCursor] = useState<string | null>(null);
  const [events, setEvents] = useState<readonly FeedEvent[]>([]);
  const [filter, setFilter] = useState<EventFilter>('all');
  const [explanations, setExplanations] = useState<Readonly<Record<string, DecisionExplanation>>>({});
  const [explanationFailure, setExplanationFailure] = useState<string | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [detail, setDetail] = useState<DecisionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const payload = useMemo(() => ({ limit: 40, cursor }), [cursor]);
  const feed = useChannel(client, 'activity.feed', payload);
  const page = feed.kind === 'ready' ? feed.value : null;

  useEffect(()=>{
    const decisionId=takeAdvisorSelection()?.decisionId;
    if(decisionId===null||decisionId===undefined) return;
    setDetailLoading(decisionId);
    void client.query('decision.detail',{decisionId}).then((result)=>{
      if(result.status==='ok') setDetail(result.value);
      else setExplanationFailure(result.issues[0]?.code??'decision_detail_failed');
      setDetailLoading(null);
    });
  },[client]);

  useEffect(() => {
    if (page === null) return;
    setEvents((prior) => {
      if (cursor === null) return page.events;
      const known = new Set(prior.map((event) => event.id));
      return [...prior, ...page.events.filter((event) => !known.has(event.id))];
    });
  }, [cursor, page]);

  if (feed.kind === 'loading' && events.length === 0) {
    return <SurfaceState kind="loading" title="Loading operational activity" />;
  }
  if (feed.kind !== 'loading' && feed.kind !== 'ready' && events.length === 0) {
    return <SurfaceState kind="error" title="Operational activity unavailable" detail={feed.issues.map((issue) => issue.code).join(', ')} />;
  }

  const nextCursor = feed.kind === 'ready' ? feed.value.nextCursor : null;
  const visibleEvents = filter === 'all' ? events : events.filter((event) => event.status === filter);
  const explain = async (decisionId: string): Promise<void> => {
    setExplaining(decisionId); setExplanationFailure(null);
    const result = await client.query('advisor.decision.explain', {
      commandId: crypto.randomUUID(), decisionId, provider: null,
    });
    if (result.status === 'ok') setExplanations((current) => ({ ...current, [decisionId]: result.value }));
    else setExplanationFailure(result.issues[0]?.code ?? 'decision_explanation_failed');
    setExplaining(null);
  };
  const inspect = async (decisionId: string): Promise<void> => {
    setDetailLoading(decisionId); setExplanationFailure(null);
    const result = await client.query('decision.detail', { decisionId });
    if (result.status === 'ok') setDetail(result.value);
    else setExplanationFailure(result.issues[0]?.code ?? 'decision_detail_failed');
    setDetailLoading(null);
  };
  return (
    <section className="panel" aria-labelledby="activity-feed-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Bounded operational evidence</p>
          <h2 id="activity-feed-heading">Decision and execution feed</h2>
        </div>
        <span className="metric-note">Newest first · immutable facts</span>
      </div>
      <div className="feed-filters" aria-label="Filter activity by outcome">
        {FILTERS.map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}
      </div>
      {visibleEvents.length === 0 ? (
        <div className="activity-empty-workspace">
          <div className="activity-empty-message">
            <strong>No operational evidence recorded yet</strong>
            <p>Events appear only after the scheduler, paper workflow, alerts, or reconciliation records a durable fact.</p>
          </div>
          <div className="activity-empty-categories" aria-label="Evidence categories monitored by this feed">
            <article><strong>Decisions</strong><span>Scheduler runs and blocked proposals</span></article>
            <article><strong>Execution</strong><span>Reviews, fills, failures, and unknown outcomes</span></article>
            <article><strong>Operations</strong><span>Alerts, incidents, recovery, and reconciliation</span></article>
          </div>
          <p className="metric-note">No placeholder events are created. This feed remains empty until immutable records exist.</p>
        </div>
      ) : (
        <ol className="activity-feed">
          {visibleEvents.map((event) => (
            <li key={event.id}>
              <span className={`event-marker status-${event.status}`} aria-hidden="true" />
              <div>
                <div className="activity-title">
                  <strong>{event.title}</strong>
                  <span>{event.status}</span>
                </div>
                <p>{event.detail}</p>
                <small>
                  <time dateTime={new Date(event.occurredAt).toISOString()}>{eventTime(event.occurredAt)}</time>
                  {event.provenance === null ? '' : ` · evidence ${event.provenance.slice(0, 12)}…`}
                </small>
                {event.reasonCode !== null && <span className="activity-reason">{event.reasonCode.replaceAll('_', ' ')}</span>}
                {event.decisionId !== null && <div className="activity-decision-actions">
                  <button type="button" aria-expanded={explanations[event.decisionId] !== undefined}
                    disabled={explaining === event.decisionId}
                    onClick={() => void explain(event.decisionId!)}><Sparkles size={14} aria-hidden="true" />
                    {explaining === event.decisionId ? 'Reading evidence…' : 'Ask Coqui why'}</button>
                  <button type="button" aria-expanded={detail?.decision.decisionId === event.decisionId}
                    disabled={detailLoading === event.decisionId}
                    onClick={() => void inspect(event.decisionId!)}>
                    {detailLoading === event.decisionId ? 'Opening…' : 'Inspect evidence'}
                  </button>
                  <button type="button" onClick={()=>void applyAdvisorNavigation(client,{target:'risk',
                    decisionId:event.decisionId,candidateId:null,productId:null,eventId:null})}>Open risk context</button>
                  <code title={event.decisionId}>decision {event.decisionId.slice(0, 10)}…</code>
                </div>}
                {event.decisionId !== null && explanations[event.decisionId] !== undefined &&
                  <article className="activity-explanation" aria-live="polite"><strong>Evidence-bound explanation</strong>
                    <p>{explanations[event.decisionId]!.text}</p><small>{explanations[event.decisionId]!.freshness} · local deterministic · no execution authority</small></article>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {detail !== null && <aside className="activity-explanation" aria-labelledby="decision-detail-heading">
        <div className="panel-heading"><div><p className="eyebrow">Historical as-of evidence</p>
          <h3 id="decision-detail-heading">Decision detail</h3></div>
          <button type="button" className="button-secondary" onClick={() => setDetail(null)}>Close</button></div>
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
              <div><dt>Connection</dt><dd title={route.connectionId}>{route.connectionId.slice(0,12)}…</dd></div>
              <div><dt>Assumptions</dt><dd title={route.assumptionHash}>{route.assumptionHash.slice(0,12)}…</dd></div></dl>
            <small>Fee, spread, liquidity, permission, and minimum evidence: unavailable in this bounded read model.</small>
          </li>)}</ol>}
        <p className="metric-note">Decision {detail.decision.decisionId} · hash {detail.decisionHash}</p>
        <ol className="activity-feed">{detail.events.map((item) => <li key={item.eventId}>
          <span className="event-marker status-info" aria-hidden="true" /><div>
            <strong>{item.event.kind.replaceAll('_', ' ')}</strong>
            <p>{item.event.kind === 'no_trade' || item.event.kind === 'stand_down' ||
              item.event.kind === 'execution_refused' ? item.event.detail.reasonCode.replaceAll('_', ' ') :
              'Recorded immutable evidence.'}</p>
            <small>{eventTime(item.event.atMs)} · {item.payloadHash.slice(0, 12)}…</small>
          </div></li>)}</ol>
      </aside>}
      {explanationFailure !== null && <p className="activity-explanation-failure" role="alert">
        Explanation unavailable: {explanationFailure.replaceAll('_', ' ')}.</p>}
      {nextCursor !== null && (
        <button className="button-secondary" onClick={() => setCursor(nextCursor)} disabled={feed.kind === 'loading'}>
          Load older activity
        </button>
      )}
    </section>
  );
}
