import type { ChannelResponse } from '@coqui/contracts';
type ActivityAnnotation = Pick<ChannelResponse<'trading.activity.summary'>['annotations'][number], 'id' | 'atMs' | 'priceUsd' | 'side' | 'amountUsd' | 'status'>;
type ActivityPosition = Pick<ChannelResponse<'trading.activity.summary'>['positions'][number], 'productId' | 'quantity' | 'entryAtMs' | 'averageEntryUsd' | 'unrealizedPnlUsd' | 'valuation' | 'status'>;
import type { WorkstationExtensionMarker } from './chart-workstation-types.js';

/** Only verified coordinates belong on the plot; unknown basis stays in the readout. */
export function chartPaperAnnotations(position: ActivityPosition | undefined, pending: readonly ActivityAnnotation[]) {
  const markers: WorkstationExtensionMarker[] = [];
  const notes: string[] = [];
  for (const action of pending) {
    const label = `${action.side === 'buy' ? 'Buy intent' : action.side === 'sell' ? 'Sell intent' : 'Paper intent'} · ${action.amountUsd ?? 'Unavailable'} USD · ${action.status.replaceAll('_', ' ')} · reference price`;
    if (action.priceUsd === null || !Number.isFinite(Number(action.priceUsd)) || Number(action.priceUsd) <= 0) notes.push(`${label.replace(' · reference price', '')} · no recorded reference price; see execution trail`);
    else markers.push({ extensionId: `proposal:${action.id}`, timeMs: action.atMs, priceUsd: action.priceUsd, label, tone: 'warning' });
  }
  if (position?.status === 'holding') {
    const profit = position.unrealizedPnlUsd === null ? 'P&L unavailable' : `${Number(position.unrealizedPnlUsd) > 0 ? '+' : ''}${Number(position.unrealizedPnlUsd).toFixed(2)} USD`;
    const label = `Position · ${position.quantity} ${position.productId.split('-')[0]} · ${profit} · ${position.valuation}`;
    if (position.averageEntryUsd === null || position.entryAtMs === null) notes.push(`${label} · entry coordinates unavailable`);
    else markers.push({ extensionId: `position:${position.productId}`, timeMs: position.entryAtMs, priceUsd: position.averageEntryUsd,
      label: `${label} · avg entry ${position.averageEntryUsd}`, tone: position.unrealizedPnlUsd === null ? 'neutral' : Number(position.unrealizedPnlUsd) < 0 ? 'negative' : 'positive' });
  }
  return { markers, notes };
}
