import type { ChannelResponse } from '@coqui/contracts';

type TimelineItem = ChannelResponse<'decision.timeline'>['items'][number];

export interface DecisionTimelineMarker {
  readonly decisionId: string;
  readonly timeMs: number;
  readonly label: string;
  readonly tone: 'positive' | 'negative' | 'warning' | 'neutral';
}

export function decisionTimelineMarkers(
  items: readonly TimelineItem[], productId: string,
): readonly DecisionTimelineMarker[] {
  const asset = productId.split('-')[0];
  return items.filter((event) =>
    event.globalScope || (asset !== undefined && event.assetScopes.includes(asset)))
    .filter((event, index, events) => events.findIndex((candidate) =>
      candidate.decisionId === event.decisionId) === index)
    .map((event) => ({
      decisionId: event.decisionId, timeMs: event.occurredAtMs,
      label: event.globalScope ? `Global decision ${event.decisionId.slice(0, 8)}` :
        `Decision ${event.decisionId.slice(0, 8)}`,
      tone: event.status === 'succeeded' ? 'positive' : event.status === 'blocked' ? 'negative' :
        event.status === 'pending' ? 'warning' : 'neutral',
    }));
}
