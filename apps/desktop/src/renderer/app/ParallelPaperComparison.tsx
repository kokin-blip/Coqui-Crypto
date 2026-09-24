import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import { SurfaceState } from './SurfaceState.js';

function usd(value: string | null): string {
  return value === null ? 'Awaiting daily mark' : `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(value: string | null): string {
  return value === null ? 'Awaiting daily mark' : `${Number(value) >= 0 ? '+' : ''}${value}%`;
}

export function ParallelPaperComparison({ client }: { readonly client: CoquiClient }): React.JSX.Element | null {
  const status = useChannel(client, 'parallel.paper.status', {});
  if (status.kind !== 'ready' || status.value.state === 'none') return null;
  const data = status.value;
  return <section className="panel exploratory-paper-summary" aria-labelledby="parallel-comparison-heading">
    <div className="panel-heading"><div><span className="status-chip status-warning">External paper comparison · {data.state}</span><h2 id="parallel-comparison-heading">TrendVol v4.2 · two paper wallets</h2></div><span className="muted">Last aligned mark {data.lastMarkDay ?? 'pending'}</span></div>
    <p className="muted">Same Coinbase UTC decision data. Coqui fills are locally modeled; Alpaca fills are independently recorded by Alpaca’s paper system. Execution times and fees can differ.</p>
    {data.lastReason !== null && <SurfaceState kind="blocked" title="Experiment needs attention" detail={data.lastReason.replaceAll('_', ' ')} compact />}
    <div className="parallel-paper-grid">
      <article><h3>Coqui · Coinbase-sized simulator</h3><dl className="settings-readout">
        <div><dt>Opening</dt><dd>{usd(data.coquiOpeningUsd)}</dd></div>
        <div><dt>Equity</dt><dd>{usd(data.coquiEquityUsd)}</dd></div>
        <div><dt>Return after modeled costs</dt><dd>{pct(data.coquiReturnPct)}</dd></div>
        <div><dt>Modeled fees</dt><dd>{usd(data.coquiFeesUsd)}</dd></div>
        <div><dt>Local fills</dt><dd>{data.coquiFillCount}</dd></div>
      </dl></article>
      <article><h3>Alpaca · external paper account</h3><dl className="settings-readout">
        <div><dt>Opening</dt><dd>{usd(data.alpacaOpeningUsd)}</dd></div>
        <div><dt>Equity</dt><dd>{usd(data.alpacaEquityUsd)}</dd></div>
        <div><dt>Return on Alpaca account</dt><dd>{pct(data.alpacaReturnPct)}</dd></div>
        <div><dt>Booked fees</dt><dd>{data.alpacaBookedFeesUsd === null ? 'Not reported separately' : usd(data.alpacaBookedFeesUsd)}</dd></div>
        <div><dt>Cost-model envelope</dt><dd>{usd(data.alpacaModeledFrictionUsd)} · not deducted again</dd></div>
        <div><dt>Orders / paper fills</dt><dd>{data.alpacaOrderCount} / {data.alpacaFillCount}</dd></div>
      </dl></article>
    </div>
    {data.positions.length > 0 && <div className="parallel-paper-positions"><h3>Holdings and target weights</h3>
      <table><thead><tr><th>Asset</th><th>Target</th><th>Coqui quantity</th><th>Alpaca paper quantity</th></tr></thead>
        <tbody>{data.positions.map((item) => <tr key={item.symbol}><td>{item.symbol}</td><td>{data.targets.find((target) => target.symbol === item.symbol)?.weightPct ?? '—'}%</td><td>{item.coquiQty}</td><td>{item.alpacaQty}</td></tr>)}</tbody></table>
    </div>}
    {data.recentTrades.length > 0 && <div className="parallel-paper-positions"><h3>Recent recorded fills</h3>
      <table><thead><tr><th>System</th><th>Recorded</th><th>Asset</th><th>Quantity</th><th>Price</th></tr></thead>
        <tbody>{data.recentTrades.toReversed().map((item, index) => <tr key={`${item.source}-${item.atMs}-${index}`}><td>{item.source === 'coqui' ? 'Coqui model' : 'Alpaca paper'}</td><td>{new Date(item.atMs).toLocaleString()}</td><td>{item.symbol}</td><td>{item.quantity}</td><td>{item.price}</td></tr>)}</tbody></table>
    </div>}
  </section>;
}
