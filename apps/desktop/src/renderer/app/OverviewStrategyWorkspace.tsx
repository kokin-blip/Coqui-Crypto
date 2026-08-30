import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatPercent } from '@coqui/ui-kit';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useChannel } from '../query/use-channel.js';

type Scoreboard = ChannelResponse<'research.scoreboard'>;
type Track = Scoreboard['tracks'][number];

const LABELS: Readonly<Record<Track['trackId'], string>> = {
  selected: 'TrendVol candidate', hold: 'Hold', passive: 'Passive',
};

interface SelectionValue {
  readonly view: Scoreboard | null;
  readonly selected: Track | null;
  select(trackId: Track['trackId']): void;
}

const SelectionContext = createContext<SelectionValue | null>(null);

export function OverviewStrategyProvider({ children, client }: { readonly children: ReactNode; readonly client: CoquiClient }): React.JSX.Element {
  const scoreboard = useChannel(client, 'research.scoreboard', {});
  const view = scoreboard.kind === 'ready' ? scoreboard.value : null;
  const initial = view?.tracks.find((track) => track.trackId === 'selected') ?? view?.tracks[0] ?? null;
  const [selectedId, setSelectedId] = useState<Track['trackId'] | null>(null);
  useEffect(() => {
    if (selectedId === null && initial !== null) setSelectedId(initial.trackId);
  }, [initial, selectedId]);
  const selected = view?.tracks.find((track) => track.trackId === selectedId) ?? initial;
  const value = useMemo<SelectionValue>(() => ({ view, selected, select: setSelectedId }), [selected, view]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

function useSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (value === null) throw new Error('OverviewStrategyProvider is missing.');
  return value;
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function AdvancedStrategyComparison(): React.JSX.Element {
  const { view, selected, select } = useSelection();
  return (
    <section className="panel strategy-comparison" aria-labelledby="strategy-comparison-heading">
      <header><div><p className="eyebrow">Registered tracks</p><h2 id="strategy-comparison-heading">Strategy comparison</h2></div><span>{view?.tracks.length ?? 0} tracks</span></header>
      {view === null ? <div className="panel-empty-body"><p>No immutable study is available for comparison.</p></div> : <div className="table-scroll"><table><thead><tr><th>Strategy</th><th>Status</th><th>After cost</th><th>Sortino</th><th>Max drawdown</th><th>Trials</th></tr></thead><tbody>{view.tracks.map((track) => <tr key={track.trackId} aria-selected={selected?.trackId === track.trackId} onClick={() => select(track.trackId)}><th><button type="button" onClick={() => select(track.trackId)}>{LABELS[track.trackId]}</button></th><td><span className="validation-state"><i aria-hidden="true" /> Not validated</span></td><td>{formatPercent(track.afterCostReturnPct)?.text ?? 'Unavailable'}</td><td>{track.sortino?.toFixed(2) ?? 'Unavailable'}</td><td className="rail-negative">{formatPercent(track.maxDrawdownPct)?.text ?? 'Unavailable'}</td><td>{track.trialCount ?? '—'}</td></tr>)}</tbody></table></div>}
      {view !== null && <footer>sample {view.sampleDays === null ? 'unavailable' : `${view.sampleDays}d`} · dataset {view.datasetHash.slice(0, 10)}… · {view.adopted ? 'adopted' : 'not adopted'}</footer>}
    </section>
  );
}

export function StrategyDetail(): React.JSX.Element {
  const { selected, view } = useSelection();
  return (
    <aside className="strategy-detail panel" aria-labelledby="strategy-detail-heading">
      <header><div><p className="eyebrow">Strategy detail</p><h2 id="strategy-detail-heading">{selected === null ? 'Unavailable' : LABELS[selected.trackId]}</h2></div></header>
      <span className="validation-state"><i aria-hidden="true" /> Not validated</span>
      <section><h3>Blocking reason</h3><strong className="rail-negative">No registered positive net-edge estimate.</strong><p>The immutable evidence gate remains unmet.</p></section>
      {selected === null ? <p>No track evidence is available.</p> : <dl className="strategy-metrics"><Metric label="After-cost return" value={formatPercent(selected.afterCostReturnPct)?.text ?? 'Unavailable'} /><Metric label="Sortino" value={selected.sortino?.toFixed(2) ?? 'Unavailable'} /><Metric label="Maximum drawdown" value={formatPercent(selected.maxDrawdownPct)?.text ?? 'Unavailable'} /><Metric label="Deflated Sharpe" value={selected.dsr?.toFixed(2) ?? 'Not tested'} /><Metric label="Trial count" value={selected.trialCount?.toString() ?? 'No search budget'} /></dl>}
      <section><h3>Provenance</h3><p>{view === null ? 'No verified source hashes.' : `dataset ${view.datasetHash.slice(0, 12)}… · run ${view.runHash.slice(0, 12)}…`}</p></section>
    </aside>
  );
}
