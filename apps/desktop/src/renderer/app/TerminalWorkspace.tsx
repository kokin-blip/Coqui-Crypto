import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Expand, PanelRight, Shrink } from 'lucide-react';
import type { CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';
import { AdvancedMarkets } from './AdvancedMarkets.js';
import { TerminalOrderBook } from './TerminalOrderBook.js';
import { TerminalDepthChart } from './TerminalDepthChart.js';
import { TerminalAlgorithm, TerminalAlgorithmDrawer } from './TerminalAlgorithm.js';
import { ChannelNotice, TerminalTabs } from './TerminalPrimitives.js';
import { TerminalAssets, TerminalProposals, TerminalResearch } from './TerminalDataTables.js';
import { ActivityControls, ActivityPositions, ActivityDecisions, useTerminalActivity } from './TerminalActivity.js';
import { formatLocalTime } from './time-format.js';
import { useQueryClient } from '@tanstack/react-query';
import { ReadinessGuide } from './ReadinessGuide.js';

const Performance = lazy(async () => ({ default: (await import('./TerminalPerformance.js')).TerminalPerformance }));
const CHART_TABS = ['Price Chart', 'Depth Chart'] as const;
const DATA_TABS = ['Assets', 'Paper Positions', 'Paper Proposals', 'Decisions', 'Performance', 'Research Runs'] as const;

function Workspace({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const [productId, setProductId] = useState('BTC-USD');
  const activity = useTerminalActivity(client, productId);
  const [aggregation, setAggregation] = useState('0.01');
  const [chartTab, setChartTab] = useState<typeof CHART_TABS[number]>('Price Chart');
  const [tab, setTab] = useState<typeof DATA_TABS[number]>('Assets');
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1600px)').matches);
  useEffect(() => { const media = window.matchMedia('(min-width: 1600px)'); const change = (): void => setWide(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
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
      <ReadinessGuide client={client} />
      <div className="terminal-market-row">
        <section ref={chartRef} className="terminal-panel terminal-price-panel">
          <div className="terminal-chart-heading"><TerminalTabs tabs={CHART_TABS} value={chartTab} onChange={setChartTab} label="Chart views" id="terminal-chart" />
            <div><button type="button" className="terminal-drawer-trigger" onClick={() => setDrawer(true)} aria-label="Open algorithm and evidence"><PanelRight size={15} /> Algorithm</button><button type="button" aria-label={fullscreen ? 'Exit chart fullscreen' : 'Fullscreen chart panel'} onClick={toggleFullscreen}>{fullscreen ? <Shrink size={16} /> : <Expand size={16} />}</button></div>
          </div>
          <ActivityControls activity={activity} />
          <div id="terminal-chart-panel" role="tabpanel" aria-labelledby={`terminal-chart-tab-${CHART_TABS.indexOf(chartTab)}`}>
            <div hidden={chartTab !== 'Price Chart'}><AdvancedMarkets client={client} active={chartTab === 'Price Chart'} activity={activity.summary.kind === 'ready' ? activity.summary.value : undefined} embedded productId={productId} onProductChange={setProductId} /></div>
            {chartTab === 'Depth Chart' && <><div className="terminal-table-toolbar"><strong>{productId}</strong><span>{aggregation} aggregation · {book.kind === 'ready' ? book.value.state : 'Unknown'}</span><a href="#/markets">Expanded chart workspace →</a></div><ChannelNotice state={book} label="Depth" />{book.kind === 'ready' && <TerminalDepthChart book={book.value} />}</>}
          </div>
        </section>
        <TerminalOrderBook client={client} productId={productId} book={book} aggregation={aggregation} onAggregation={setAggregation} onProductChange={setProductId} />
      </div>
      <section className="terminal-panel terminal-bottom"><TerminalTabs tabs={DATA_TABS} value={tab} onChange={setTab} label="Account and algorithm data" id="terminal-data" />
        <div id="terminal-data-panel" role="tabpanel" aria-labelledby={`terminal-data-tab-${DATA_TABS.indexOf(tab)}`} className="terminal-data-content">
          {tab === 'Assets' && <TerminalAssets client={client} connectionId={activity.connectionId} onProductChange={setProductId} />}
          {tab === 'Paper Positions' && <ActivityPositions client={client} activity={activity} productId={productId} onProductChange={setProductId} />}
          {tab === 'Paper Proposals' && <TerminalProposals client={client} />}
          {tab === 'Decisions' && <ActivityDecisions activity={activity} productId={productId} />}
          {tab === 'Research Runs' && <TerminalResearch client={client} />}
          {tab === 'Performance' && <Suspense fallback={<div className="terminal-empty">Loading performance…</div>}><Performance client={client} /></Suspense>}
        </div>
      </section>
    </div>
    <aside className="terminal-sidebar" aria-label="Algorithm and portfolio">{wide && <TerminalAlgorithm client={client} productId={productId} activity={activity} />}</aside>
    <footer className="terminal-operating-footer"><a href="#/markets">Watchlist ↗</a><span>{productId} · Coinbase {live.kind === 'ready' ? live.value.connection : 'unknown'}</span><span>Last message {live.kind === 'ready' && live.value.lastMessageAtMs !== null ? formatLocalTime(live.value.lastMessageAtMs) : 'Unavailable'}</span><span>{status.kind === 'ready' ? status.value.killSwitchEngaged ? 'Safety stop engaged' : `Risk ${status.value.riskStage ?? 'unassessed'}` : 'Safety unknown'}</span><span>Display data · Paper execution only</span></footer>
    {drawer && <TerminalAlgorithmDrawer client={client} activity={activity} productId={productId} onClose={() => setDrawer(false)} />}
  </div>;
}

export function TerminalWorkspace({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const profiles = useChannel(client, 'accounts.profiles', {});
  const queries = useQueryClient();
  if (profiles.kind !== 'ready') return <div className="terminal-empty">
    <ChannelNotice state={profiles} label="Profile" />
    {profiles.kind !== 'loading' && <><button type="button" className="button-secondary"
      onClick={() => void queries.invalidateQueries({ queryKey: ['accounts.profiles'] })}>Retry profile read</button>
      <a href="#/settings">Open diagnostics</a></>}
  </div>;
  return <Workspace key={profiles.kind === 'ready' ? profiles.value.activeProfile.id : 'loading-profile'} client={client} />;
}
