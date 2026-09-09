import {
  AreaChart, CandlestickChart, ChevronDown, Grid2X2, Layers3, LineChart,
  MoreHorizontal, Puzzle, Save, SlidersHorizontal,
} from 'lucide-react';

import type {
  WorkstationChartStyle, WorkstationIndicators, WorkstationLayout, WorkstationScaleMode,
} from './chart-workstation-types.js';

const INDICATORS: ReadonlyArray<readonly [keyof WorkstationIndicators, string]> = [
  ['sma20', 'SMA 20'], ['sma50', 'SMA 50'], ['ema20', 'EMA 20'],
  ['bollinger20', 'Bollinger 20/2'], ['rsi14', 'RSI 14'], ['macd', 'MACD 12/26/9'],
];

export interface SavedChartLayout {
  readonly id: string;
  readonly name: string;
  readonly layout: WorkstationLayout;
}

export function MarketWorkspaceToolbar({ style, scaleMode, indicators, volumeVisible,
  layout, savedLayouts, activeLayoutId, saving, extensionsOpen, onStyle, onScale,
  onIndicators, onVolume, onLayout, onApplyLayout, onSave, onOpenExtensions }: {
  readonly style: WorkstationChartStyle;
  readonly scaleMode: WorkstationScaleMode;
  readonly indicators: WorkstationIndicators;
  readonly volumeVisible: boolean;
  readonly layout: WorkstationLayout;
  readonly savedLayouts: readonly SavedChartLayout[];
  readonly activeLayoutId: string | null;
  readonly saving: boolean;
  readonly extensionsOpen: boolean;
  readonly onStyle: (style: WorkstationChartStyle) => void;
  readonly onScale: (scale: WorkstationScaleMode) => void;
  readonly onIndicators: (indicators: WorkstationIndicators) => void;
  readonly onVolume: (visible: boolean) => void;
  readonly onLayout: (layout: WorkstationLayout) => void;
  readonly onApplyLayout: (id: string | null) => void;
  readonly onSave: () => void;
  readonly onOpenExtensions: () => void;
}): React.JSX.Element {
  const enabledCount = Object.values(indicators).filter(Boolean).length;
  return <div className="market-workspace-controls">
    <div className="market-style-control" aria-label="Chart style">
      <button type="button" aria-label="Candlestick chart" aria-pressed={style === 'candles'} onClick={() => onStyle('candles')}><CandlestickChart size={16} /></button>
      <button type="button" aria-label="Line chart" aria-pressed={style === 'line'} onClick={() => onStyle('line')}><LineChart size={16} /></button>
      <button type="button" aria-label="Area chart" aria-pressed={style === 'area'} onClick={() => onStyle('area')}><AreaChart size={16} /></button>
      <button type="button" aria-label="Baseline chart" aria-pressed={style === 'baseline'} onClick={() => onStyle('baseline')}><Layers3 size={16} /></button>
    </div>
    <details className="chart-options-popover toolbar-group-chart">
      <summary className="compact-control"><SlidersHorizontal size={14} /> Chart{enabledCount > 0 ? ` · ${enabledCount}` : ''}<ChevronDown size={13} /></summary>
      <div className="chart-options-panel">
        <fieldset><legend>Studies</legend>{INDICATORS.map(([key, label]) => <label key={key}><input type="checkbox" checked={indicators[key]} onChange={() => onIndicators({ ...indicators, [key]: !indicators[key] })} />{label}</label>)}</fieldset>
        <fieldset><legend>Display</legend><label><input type="checkbox" checked={volumeVisible} onChange={(event) => onVolume(event.target.checked)} />Volume</label><label>Scale<select value={scaleMode} onChange={(event) => onScale(event.target.value as WorkstationScaleMode)}><option value="linear">Linear</option><option value="percentage">Percentage</option><option value="indexed">Indexed to 100</option><option value="logarithmic">Logarithmic</option></select></label></fieldset>
      </div>
    </details>
    <details className="chart-options-popover toolbar-group-layout">
      <summary className="compact-control"><Grid2X2 size={14} /> Layout<ChevronDown size={13} /></summary>
      <div className="chart-options-panel toolbar-layout-panel">
        <label className="compact-select"><span>Arrangement</span><select value={layout} onChange={(event) => onLayout(event.target.value as WorkstationLayout)}><option value="single">Single</option><option value="horizontal">Side by side</option><option value="vertical">Stacked</option><option value="grid">2 × 2</option><option value="dominant">Dominant + 3</option></select></label>
        <label className="compact-select saved-layout-select"><span>Saved view</span><Layers3 size={14} /><select value={activeLayoutId ?? ''} onChange={(event) => onApplyLayout(event.target.value === '' ? null : event.target.value)}><option value="">Current workspace</option>{savedLayouts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
    </details>
    <details className="chart-options-popover toolbar-group-more">
      <summary className="compact-control" aria-label="More chart commands"><MoreHorizontal size={15} /> More<ChevronDown size={13} /></summary>
      <div className="chart-options-panel toolbar-more-panel">
        <button type="button" className="compact-control" aria-expanded={extensionsOpen} onClick={onOpenExtensions}><Puzzle size={14} /> Extensions</button>
        <button type="button" className="compact-control save-chart-view" disabled={saving} onClick={onSave}><Save size={14} /> Save view</button>
      </div>
    </details>
  </div>;
}
