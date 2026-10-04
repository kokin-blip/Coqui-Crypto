import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Expand, PanelRight, Shrink } from 'lucide-react';
import type { CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';
import { AdvancedMarkets } from './AdvancedMarkets.js';
import { TerminalOrderBook } from './TerminalOrderBook.js';
import { TerminalDepthChart } from './TerminalDepthChart.js';
import { TerminalAlgorithm, TerminalAlgorithmDrawer } from './TerminalAlgorithm.js';
import { ChannelNotice, TerminalTabs } from './TerminalPrimitives.js';
import { TerminalAssets, TerminalPositions, TerminalProposals, TerminalDecisions, TerminalResearch } from './TerminalDataTables.js';
import { formatLocalTime } from './time-format.js';

const Performance = lazy(async () => ({ default: (await import('./TerminalPerformance.js')).TerminalPerformance }));
const CHART_TABS = ['Price Chart', 'Depth Chart'] as const;
const DATA_TABS = ['Assets', 'Paper Positions', 'Paper Proposals', 'Decisions', 'Performance', 'Research Runs'] as const;

function Workspace({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const [productId, setProductId] = useState('BTC-USD');
  const [aggregation, setAggregation] = useState('0.01');
  const [chartTab, setChartTab] = useState<typeof CHART_TABS[number]>('Price Chart');
  const [tab, setTab] = useState<typeof DATA_TABS[number]>('Assets');
  const [drawer, setDrawer] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const chartRef = useRef<HTMLElement>(null);
  const book = useChannel(client, 'market-data.order-book', { productId, aggregation, limit: 12 });
  const live = useChannel(client, 'market-data.live', {});
  const status = useChannel(client, 'app.status-rail', {});
  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === chartRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    else if (chartRef.current !== null) void chartRef.current.requestFullscreen();
  };
  return <div className="terminal-workspace">
    <div className="terminal-main">
      <div className="terminal-market-row">
        <section ref={chartRef} className="terminal-panel terminal-price-panel">
          <div className="terminal-chart-heading"><TerminalTabs tabs={CHART_TABS} value={chartTab} onChange={setChartTab} label="Chart views" id="terminal-chart" />
            <div><button type="button" className="terminal-drawer-trigger" onClick={() => setDrawer(true)} aria-label="Open algorithm and evidence"><PanelRight size={15} /> Algorithm</button><button type="button" aria-label={fullscreen ? 'Exit chart fullscreen' : 'Fullscreen chart panel'} onClick={toggleFullscreen}>{fullscreen ? <Shrink size={16} /> : <Expand size={16} />}</button></div>
          </div>
          <div id="terminal-chart-panel" role="tabpanel" aria-labelledby={`terminal-chart-tab-${CHART_TABS.indexOf(chartTab)}`}>
            <div hidden={chartTab !== 'Price Chart'}><AdvancedMarkets client={client} embedded productId={productId} onProductChange={setProductId} /></div>
            {chartTab === 'Depth Chart' && <><div className="terminal-table-toolbar"><strong>{productId}</strong><span>{aggregation} aggregation · {book.kind === 'ready' ? book.value.state : 'Unknown'}</span><a href="#/markets">Expanded chart workspace →</a></div><ChannelNotice state={book} label="Depth" />{book.kind === 'ready' && <TerminalDepthChart book={book.value} />}</>}
          </div>
        </section>
        <TerminalOrderBook client={client} productId={productId} book={book} aggregation={aggregation} onAggregation={setAggregation} onProductChange={setProductId} />
      </div>
      <section className="terminal-panel terminal-bottom"><TerminalTabs tabs={DATA_TABS} value={tab} onChange={setTab} label="Account and algorithm data" id="terminal-data" />
        <div id="terminal-data-panel" role="tabpanel" aria-labelledby={`terminal-data-tab-${DATA_TABS.indexOf(tab)}`} className="terminal-data-content">
          {tab === 'Assets' && <TerminalAssets client={client} onProductChange={setProductId} />}
          {tab === 'Paper Positions' && <TerminalPositions client={client} onProductChange={setProductId} />}
          {tab === 'Paper Proposals' && <TerminalProposals client={client} />}
          {tab === 'Decisions' && <TerminalDecisions client={client} productId={productId} />}
          {tab === 'Research Runs' && <TerminalResearch client={client} />}
          {tab === 'Performance' && <Suspense fallback={<div className="terminal-empty">Loading performance…</div>}><Performance client={client} /></Suspense>}
        </div>
      </section>
    </div>
    <aside className="terminal-sidebar" aria-label="Algorithm and portfolio"><TerminalAlgorithm client={client} productId={productId} /></aside>
    <footer className="terminal-operating-footer"><a href="#/markets">Watchlist ↗</a><span>{productId} · Coinbase {live.kind === 'ready' ? live.value.connection : 'unknown'}</span><span>Last message {live.kind === 'ready' && live.value.lastMessageAtMs !== null ? formatLocalTime(live.value.lastMessageAtMs) : 'Unavailable'}</span><span>{status.kind === 'ready' ? status.value.killSwitchEngaged ? 'Safety stop engaged' : `Risk ${status.value.riskStage ?? 'unassessed'}` : 'Safety unknown'}</span><span>Display data · Paper execution only</span></footer>
    {drawer && <TerminalAlgorithmDrawer client={client} productId={productId} onClose={() => setDrawer(false)} />}
  </div>;
}

export function TerminalWorkspace({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const profiles = useChannel(client, 'accounts.profiles', {});
  return <Workspace key={profiles.kind === 'ready' ? profiles.value.activeProfile.id : 'loading-profile'} client={client} />;
}
