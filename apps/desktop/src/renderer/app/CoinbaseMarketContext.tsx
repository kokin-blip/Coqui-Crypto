import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';

type Snapshot = ChannelResponse<'market-data.coinbase-diagnostics'>;

function stamp(atMs: number | null): string {
  return atMs === null ? 'Not observed' : new Date(atMs).toLocaleString();
}

function price(value: string | undefined): string {
  return value === undefined ? 'Unavailable' : formatUsd(value)?.text ?? value;
}

function state(value: { readonly state: string; readonly observedAtMs: number | null }): string {
  return `${value.state === 'fresh' ? 'Observed' : value.state === 'stale' ? 'Stale' : 'Unavailable'} · ${stamp(value.observedAtMs)}`;
}

function spread(snapshot: Snapshot): string {
  const quote = snapshot.quote.data;
  if (quote === null) return 'Unavailable';
  const bid = Number(quote.bid), ask = Number(quote.ask);
  return `${(((ask - bid) / ((ask + bid) / 2)) * 10_000).toFixed(1)} bps`;
}

export function CoinbaseMarketContext({ client, productId, compact = false }: {
  readonly client: CoquiClient; readonly productId: string; readonly compact?: boolean;
}): React.JSX.Element {
  const result = useChannel(client, 'market-data.coinbase-diagnostics', { productId });
  return <section className={`coinbase-market-context${compact ? ' compact' : ''}`} aria-label={`Coinbase market context for ${productId}`}>
    {!compact && <header><h3>Coinbase market context · {productId}</h3><small>Advanced Trade REST · informational only</small></header>}
    {result.kind === 'loading' && <p className="muted">Reading Coinbase market snapshots…</p>}
    {result.kind !== 'loading' && result.kind !== 'ready' && <p className="muted">Coinbase market context unavailable.</p>}
    {result.kind === 'ready' && <ContextDetails snapshot={result.value} compact={compact} />}
  </section>;
}

function ContextDetails({ snapshot, compact }: { readonly snapshot: Snapshot; readonly compact: boolean }): React.JSX.Element {
  const product = snapshot.product.data;
  const book = snapshot.book.data;
  return <>
    {compact && <strong>{snapshot.productId}</strong>}
    <dl className="coinbase-context-facts">
      <div><dt>Best bid / ask</dt><dd>{price(snapshot.quote.data?.bid)} / {price(snapshot.quote.data?.ask)}</dd><small>Best Bid/Ask · {state(snapshot.quote)}</small></div>
      <div><dt>Spread</dt><dd>{spread(snapshot)}</dd></div>
      <div><dt>Coinbase product</dt><dd>{product?.status ?? 'Unavailable'}{product?.tradingDisabled ? ' · trading disabled' : ''}</dd><small>Get Product · {state(snapshot.product)}</small></div>
      <div><dt>Book</dt><dd>{book === null ? 'Unavailable' : `${book.bids.length} bid / ${book.asks.length} ask levels`}</dd><small>Get Product Book · {state(snapshot.book)}</small></div>
    </dl>
    {!compact && <>
      {product !== null && <p className="coinbase-product-flags">Trading flags: {[
        product.cancelOnly && 'cancel only', product.limitOnly && 'limit only', product.postOnly && 'post only',
      ].filter(Boolean).join(', ') || 'none'} · Base increment {product.baseIncrement} · Quote increment {product.quoteIncrement} · Minimum quote {product.quoteMinSize}</p>}
      {book !== null && <div className="coinbase-book-grid"><div><h4>Bids</h4><BookTable levels={book.bids} /></div><div><h4>Asks</h4><BookTable levels={book.asks} /></div></div>}
      <p className="muted">Coinbase depth describes Coinbase liquidity. Alpaca paper fills are reported separately by Alpaca.</p>
    </>}
  </>;
}

function BookTable({ levels }: { readonly levels: readonly { readonly price: string; readonly size: string }[] }): React.JSX.Element {
  return <table><thead><tr><th>Price</th><th>Size</th></tr></thead><tbody>{levels.map((level, index) =>
    <tr key={`${level.price}:${index}`}><td>{price(level.price)}</td><td>{level.size}</td></tr>)}</tbody></table>;
}
