import { Bot, Database, ShieldCheck, Sparkles } from 'lucide-react';

import type { WorkstationBar } from './chart-workstation-types.js';

function percentChange(first: string, last: string): string | null {
  const start = Number(first); const end = Number(last);
  return Number.isFinite(start) && start > 0 && Number.isFinite(end)
    ? `${((end / start - 1) * 100).toFixed(2)}%`
    : null;
}

export function MarketFactsPanel({ productId, bars, freshness, onOpenAnalyst }: {
  readonly productId: string;
  readonly bars: readonly WorkstationBar[];
  readonly freshness: string;
  readonly onOpenAnalyst: () => void;
}): React.JSX.Element {
  const complete = bars.filter((bar) => bar.isComplete);
  const first = complete[0]; const last = complete.at(-1);
  const high = complete.length === 0 ? null : Math.max(...complete.map((bar) => Number(bar.high)));
  const low = complete.length === 0 ? null : Math.min(...complete.map((bar) => Number(bar.low)));
  const missing = complete.slice(1).reduce((count, bar, index) => {
    const prior = complete[index];
    if (prior === undefined) return count;
    const expected = prior.endTimeMs;
    return count + (bar.startTimeMs > expected ? 1 : 0);
  }, 0);
  return <aside className="market-facts-inspector" aria-labelledby="market-facts-heading">
    <header><div><span className="violet-kicker"><Sparkles size={14} /> Key facts</span><h2 id="market-facts-heading">{productId}</h2></div><button type="button" className="icon-button" aria-label="Open AI analyst" onClick={onOpenAnalyst}><Bot size={17} /></button></header>
    <div className="market-fact-list">
      <div><span>Observed move</span><strong>{first !== undefined && last !== undefined ? percentChange(first.open, last.close) : 'Unavailable'}</strong></div>
      <div><span>Visible range</span><strong>{high === null || low === null ? 'Unavailable' : `${low.toLocaleString()} – ${high.toLocaleString()}`}</strong></div>
      <div><span>Completed bars</span><strong>{complete.length}</strong></div>
      <div><span>Detected gaps</span><strong>{missing}</strong></div>
    </div>
    <section className="facts-boundary"><ShieldCheck size={15} /><div><strong>Local facts</strong><span>Calculated from displayed completed Coinbase candles only.</span></div></section>
    <section className="facts-provenance"><div><Database size={15} /><strong>Provenance</strong></div><span>Coinbase Exchange REST</span><span>{freshness}</span></section>
    <button type="button" className="advisor-launch" onClick={onOpenAnalyst}><Sparkles size={15} /> Ask Coqui analyst</button>
    <small>Advisory only · No execution authority</small>
  </aside>;
}
