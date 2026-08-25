import { useEffect, useMemo, useState } from 'react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';

type FeedEvent = ChannelResponse<'activity.feed'>['events'][number];

function eventTime(at: number): string {
  return new Date(at).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

export function Activity({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const [cursor, setCursor] = useState<string | null>(null);
  const [events, setEvents] = useState<readonly FeedEvent[]>([]);
  const payload = useMemo(() => ({ limit: 40, cursor }), [cursor]);
  const feed = useChannel(client, 'activity.feed', payload);
  const page = feed.kind === 'ready' ? feed.value : null;

  useEffect(() => {
    if (page === null) return;
    setEvents((prior) => {
      if (cursor === null) return page.events;
      const known = new Set(prior.map((event) => event.id));
      return [...prior, ...page.events.filter((event) => !known.has(event.id))];
    });
  }, [cursor, page]);

  if (feed.kind === 'loading' && events.length === 0) {
    return <p aria-live="polite">Loading operational activity…</p>;
  }
  if (feed.kind !== 'loading' && feed.kind !== 'ready' && events.length === 0) {
    return <p role="alert">Activity unavailable: {feed.issues.map((issue) => issue.code).join(', ')}</p>;
  }

  const nextCursor = feed.kind === 'ready' ? feed.value.nextCursor : null;
  return (
    <section className="panel" aria-labelledby="activity-feed-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Bounded operational evidence</p>
          <h2 id="activity-feed-heading">Decision and execution feed</h2>
        </div>
        <span className="metric-note">Newest first · immutable facts</span>
      </div>
      {events.length === 0 ? (
        <p className="empty-copy">No scheduler decisions, paper events, fills, alerts, reconciliation incidents, or operational failures have been recorded.</p>
      ) : (
        <ol className="activity-feed">
          {events.map((event) => (
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
              </div>
            </li>
          ))}
        </ol>
      )}
      {nextCursor !== null && (
        <button className="button-secondary" onClick={() => setCursor(nextCursor)} disabled={feed.kind === 'loading'}>
          Load older activity
        </button>
      )}
    </section>
  );
}
