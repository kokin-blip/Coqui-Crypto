import { CalendarClock, ShieldCheck } from 'lucide-react';

import type { ChannelResponse,CoquiClient } from '@coqui/contracts';
import { EvidenceExplainButton } from './EvidenceExplainButton.js';
import { applyAdvisorNavigation } from './advisor-navigation.js';

type TimelineEvent = ChannelResponse<'market-events.timeline'>['events'][number];

export function eventMatchesProduct(event: TimelineEvent, productId: string): boolean {
  const symbol = productId.split('-')[0] ?? productId;
  return event.assetSymbols.length === 0 || event.assetSymbols.includes(symbol);
}

export function MarketEventsPanel({ client,events, state, productId }: {
  readonly client:CoquiClient;
  readonly events: readonly TimelineEvent[];
  readonly state: 'loading' | 'ready' | 'unavailable';
  readonly productId: string;
}): React.JSX.Element {
  const relevant = events.filter((event) => eventMatchesProduct(event, productId)).slice(0, 8);
  return <section className="market-event-timeline" aria-labelledby="market-events-heading">
    <header className="panel-heading">
      <div><h2 id="market-events-heading">Known market events</h2><p>Shown when Coqui first had the information.</p></div>
      <span className="data-boundary"><ShieldCheck size={14} aria-hidden="true" /> Context only · target influence disabled</span>
    </header>
    {state === 'loading' && <p className="empty-copy" aria-live="polite">Loading the local event timeline…</p>}
    {state === 'unavailable' && <p className="empty-copy" role="alert">Event context is unavailable. Prices and strategy state are unchanged.</p>}
    {state === 'ready' && relevant.length === 0 && <p className="empty-copy">No local events were available for {productId} at this time.</p>}
    {state === 'ready' && relevant.length > 0 && <ol>{relevant.map((event) => <li key={event.id}>
      <div><strong>{event.title}</strong><span>{event.classification === null ? 'Unclassified at this as-of' :
        `${event.classification.label.replace('_', ' ')} · ${event.classification.importance}`}</span></div>
      <time dateTime={new Date(event.firstSeenAtMs).toISOString()}><CalendarClock size={13} aria-hidden="true" /> Known {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(event.firstSeenAtMs)}</time>
      <small title={event.provenanceHash}>Local provenance {event.provenanceHash.slice(0, 10)}</small>
      <div className="market-event-actions"><EvidenceExplainButton client={client} subject={{kind:'market_event',id:event.id}} label="Why is this relevant?" />
        <button type="button" className="button-secondary" onClick={()=>void applyAdvisorNavigation(client,{target:'market',
          decisionId:null,candidateId:null,productId,eventId:event.id})}>Open event evidence</button></div>
    </li>)}</ol>}
  </section>;
}
