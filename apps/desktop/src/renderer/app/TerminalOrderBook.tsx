import { useState } from 'react';
import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice, TerminalTabs } from './TerminalPrimitives.js';
import { formatLocalTime } from './time-format.js';

type Book = ChannelResponse<'market-data.order-book'>;
const TABS = ['Order Book', 'Recent Trades'] as const;

function BookRows({ levels, side, peak }: { readonly levels: Book['bids']; readonly side: 'bid' | 'ask'; readonly peak: number }): React.JSX.Element {
  return <>{levels.map((level) => <tr key={level.price} className={`book-${side}`} style={{
    backgroundImage: `linear-gradient(to left, var(--coqui-${side === 'bid' ? 'positive' : 'negative'}-soft) ${Math.min(100, Number(level.total) / peak * 100)}%, transparent 0)`,
  }}><td>{formatUsd(level.price)?.text ?? level.price}</td><td>{level.size}</td><td>{level.total}</td></tr>)}</>;
}

function Trades({ client, productId }: { readonly client: CoquiClient; readonly productId: string }): React.JSX.Element {
  const state = useChannel(client, 'market-data.recent-trades', { productId, limit: 100 });
  return <><ChannelNotice state={state} label="Recent trades" />{state.kind === 'ready' && <>
    {state.value.connection !== 'live' && <p className="terminal-state-note">Feed {state.value.connection} · last observations</p>}
    {state.value.incomplete && <p className="terminal-state-note">Feed gap detected · tape is incomplete</p>}
    {state.value.trades.length === 0 ? <div className="terminal-empty">No trades observed in this connection.</div> : <table className="terminal-book-table"><thead><tr><th>Price (USD)</th><th>Amount</th><th>Time</th></tr></thead><tbody>
      {state.value.trades.map((trade) => <tr key={trade.tradeId} className={`book-${trade.takerSide === 'buy' ? 'bid' : 'ask'}`}>
        <td title={`${trade.takerSide} aggressor`}>{trade.takerSide === 'buy' ? '↑ ' : '↓ '}{formatUsd(trade.price)?.text ?? trade.price}</td><td>{trade.size}</td><td title={new Date(trade.observedAtMs).toISOString()}>{formatLocalTime(trade.observedAtMs)}</td>
      </tr>)}</tbody></table>}
  </>}</>;
}

export function TerminalOrderBook({ client, productId, book, aggregation, onAggregation, onProductChange }: {
  readonly client: CoquiClient; readonly productId: string; readonly book: ReturnType<typeof useChannel<'market-data.order-book'>>;
  readonly onProductChange: (productId: string) => void; readonly aggregation: string; readonly onAggregation: (value: string) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<typeof TABS[number]>('Order Book');
  const catalog = useChannel(client, 'market-data.products', { query: '', limit: 500 });
  const products = [...new Set([productId, ...(catalog.kind === 'ready' ? catalog.value.products.map((p) => p.instrument.productId) : [])])];
  const quote = useChannel(client, 'market-data.live', {});
  const current = quote.kind === 'ready' ? quote.value.quotes.find((item) => item.instrument.productId === productId) : undefined;
  const ready = book.kind === 'ready' ? book.value : null;
  const peak = Math.max(Number(ready?.bids.at(-1)?.total ?? 0), Number(ready?.asks.at(-1)?.total ?? 0), 0.000001);
  return <section className="terminal-panel terminal-microstructure">
    <TerminalTabs tabs={TABS} value={tab} onChange={setTab} label="Market microstructure" id="microstructure" />
    <div className="terminal-book-controls"><label><span className="sr-only">Market</span><select aria-label="Order book market" value={productId} onChange={(event) => onProductChange(event.target.value)}>{products.map((id) => <option key={id}>{id}</option>)}</select></label><label><span className="sr-only">Price aggregation</span><select aria-label="Price aggregation" value={aggregation} onChange={(event) => onAggregation(event.target.value)}>
      {['0.0001', '0.001', '0.01', '0.1', '1', '10', '100'].map((step) => <option key={step}>{step}</option>)}</select></label>
      <span className={ready?.connection === 'live' ? 'terminal-positive' : 'terminal-warning'}>● {ready?.connection ?? 'Unknown'}</span></div>
    <div id="microstructure-panel" role="tabpanel" aria-labelledby={`microstructure-tab-${TABS.indexOf(tab)}`} className="terminal-book-scroll">
      {tab === 'Recent Trades' ? <Trades client={client} productId={productId} /> : <>
        <ChannelNotice state={book} label="Order book" />
        {ready !== null && <>{ready.state !== 'ready' && <p className="terminal-state-note">{ready.state === 'stale' ? 'Stale snapshot · last observed values' : 'Awaiting Level 2 snapshot'}</p>}
          {ready.bids.length + ready.asks.length === 0 ? <div className="terminal-empty">No depth available for {productId}.</div> : <table className="terminal-book-table"><thead><tr><th>Price (USD)</th><th>Amount ({productId.split('-')[0]})</th><th>Total</th></tr></thead><tbody>
            <BookRows levels={[...ready.asks].reverse()} side="ask" peak={peak} />
            <tr className="terminal-midpoint"><td colSpan={3}><strong>{current === undefined ? 'Last price unavailable' : formatUsd(current.priceUsd)?.text}</strong><span>Last trade · {quote.kind === 'ready' ? quote.value.connection : 'unknown'}</span></td></tr>
            <BookRows levels={ready.bids} side="bid" peak={peak} />
          </tbody></table>}
        </>}
      </>}
    </div><footer>Coinbase · {ready?.observedAtMs === null || ready?.observedAtMs === undefined ? 'Not observed' : formatLocalTime(ready.observedAtMs)} · display only</footer>
  </section>;
}
