import type { ChannelResponse } from '@coqui/contracts';

export function TerminalDepthChart({ book }: { readonly book: ChannelResponse<'market-data.order-book'> }): React.JSX.Element {
  const levels = [...book.bids].reverse().concat(book.asks);
  if (levels.length === 0) return <div className="terminal-empty">Awaiting a fresh Coinbase order-book snapshot.</div>;
  const min = Number(levels[0]!.price), max = Number(levels.at(-1)!.price);
  const peak = Math.max(...levels.map((level) => Number(level.total)), 0.000001);
  const x = (price: string): number => 40 + ((Number(price) - min) / Math.max(max - min, 0.000001)) * 920;
  const y = (total: string): number => 420 - (Number(total) / peak) * 360;
  const path = (side: typeof book.bids): string => side.map((level, index) => `${index === 0 ? 'M' : 'L'}${x(level.price)},${y(level.total)}`).join(' ');
  const bids = [...book.bids].reverse(), asks = book.asks;
  return <figure className="terminal-depth-chart"><svg viewBox="0 0 1000 460" role="img"
    aria-label={`Coinbase cumulative ${book.instrument.productId} depth, limited to ${book.bids.length} bid and ${book.asks.length} ask price buckets`}>
    {[60, 150, 240, 330, 420].map((at) => <line key={at} x1="40" x2="960" y1={at} y2={at} className="depth-grid" />)}
    {[bids, asks].map((side, index) => side.length === 0 ? null : <g key={index} className={index === 0 ? 'depth-bids' : 'depth-asks'}>
      <path d={`${path(side)} L${x(side.at(-1)!.price)},420 L${x(side[0]!.price)},420 Z`} className="depth-fill" />
      <path d={path(side)} className="depth-line" /></g>)}
    <text x="40" y="450">{levels[0]!.price} USD</text><text x="960" y="450" textAnchor="end">{levels.at(-1)!.price} USD</text>
  </svg><figcaption>Cumulative amount · visible price buckets only · informational market data</figcaption></figure>;
}
