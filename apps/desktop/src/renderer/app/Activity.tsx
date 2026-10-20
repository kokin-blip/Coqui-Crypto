import { DecisionEvidencePanel } from './DecisionEvidencePanel.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import { SurfaceState } from './SurfaceState.js';
import { applyAdvisorNavigation,takeAdvisorSelection } from './advisor-navigation.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';

type FeedEvent = ChannelResponse<'activity.feed'>['events'][number];
type DecisionExplanation = ChannelResponse<'advisor.decision.explain'>;
type DecisionDetail = ChannelResponse<'decision.detail'>;
type EventFilter = 'all' | FeedEvent['status'];
const FILTERS: readonly EventFilter[] = ['all', 'info', 'pending', 'blocked', 'failed', 'succeeded', 'unknown'];

function eventTime(at: number): string {
  return formatLocalTimestamp(at);
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
  const detailHeadingRef = useCallback((heading: HTMLHeadingElement | null) => {
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }, []);
  const detailOpenerRef = useRef<HTMLButtonElement | null>(null);
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
  const inspect = async (decisionId: string, opener: HTMLButtonElement): Promise<void> => {
    detailOpenerRef.current = opener;
    setDetailLoading(decisionId); setExplanationFailure(null);
    const result = await client.query('decision.detail', { decisionId });
    if (result.status === 'ok') setDetail(result.value);
    else setExplanationFailure(result.issues[0]?.code ?? 'decision_detail_failed');
    setDetailLoading(null);
  };
  const closeDetail = (): void => {
    setDetail(null);
    requestAnimationFrame(() => {
      const target = detailOpenerRef.current?.isConnected ? detailOpenerRef.current : document.querySelector<HTMLElement>('#activity-feed-heading');
      if (target?.tagName !== 'BUTTON') target?.setAttribute('tabindex','-1');
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
      detailOpenerRef.current = null;
    });
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
                  <time dateTime={exactUtcTimestamp(event.occurredAt)} title={exactUtcTimestamp(event.occurredAt)}>{eventTime(event.occurredAt)}</time>
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
                    aria-controls="decision-detail"
                    onClick={(click) => void inspect(event.decisionId!, click.currentTarget)}>
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
      {detail !== null && <DecisionEvidencePanel client={client} detail={detail} onClose={closeDetail} headingRef={detailHeadingRef}/>}
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
