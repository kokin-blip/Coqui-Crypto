import {
  Columns2, List, MousePointer2, PanelRight, PanelTop, PenTool,
  RectangleHorizontal, SlidersHorizontal, TextCursorInput, TrendingUp, Waves, X,
} from 'lucide-react';

import type { DrawingTool } from './chart-workstation-types.js';

const TOOLS: ReadonlyArray<readonly [DrawingTool, React.ComponentType<{ size?: number }>, string]> = [
  ['cursor', MousePointer2, 'Pointer'], ['horizontal', PanelTop, 'Horizontal line'],
  ['vertical', Columns2, 'Vertical line'], ['trend', TrendingUp, 'Trend line'],
  ['ray', TrendingUp, 'Ray'], ['rectangle', RectangleHorizontal, 'Range'],
  ['fibonacci', Waves, 'Fibonacci'], ['text', TextCursorInput, 'Text'],
  ['measure', SlidersHorizontal, 'Measure'],
];

export function MarketPanelTriggers({ toolsOpen, watchlistOpen, factsOpen, onTools, onWatchlist, onFacts }: {
  readonly toolsOpen: boolean; readonly watchlistOpen: boolean; readonly factsOpen: boolean;
  readonly onTools: () => void; readonly onWatchlist: () => void; readonly onFacts: () => void;
}): React.JSX.Element {
  return <div className="market-panel-triggers">
    <button type="button" className="market-tools-trigger" aria-expanded={toolsOpen} onClick={onTools}><PenTool size={14} /> Draw</button>
    <button type="button" className="market-watchlist-trigger" aria-expanded={watchlistOpen} onClick={onWatchlist}><List size={14} /> Watchlist</button>
    <button type="button" className="market-facts-trigger" aria-expanded={factsOpen} onClick={onFacts}><PanelRight size={14} /> Facts</button>
  </div>;
}

export function MarketDrawingTools({ activeTool, open, onChange, onClose }: {
  readonly activeTool: DrawingTool; readonly open: boolean;
  readonly onChange: (tool: DrawingTool) => void; readonly onClose: () => void;
}): React.JSX.Element {
  return <nav className={`drawing-tool-rail${open ? ' panel-open' : ''}`} aria-label="Chart drawing tools">
    <button type="button" className="market-panel-close" aria-label="Close drawing tools" onClick={onClose}><X size={16} /></button>
    {TOOLS.map(([tool, Icon, label]) => <button key={tool} type="button" aria-label={label} title={label} aria-pressed={activeTool === tool} onClick={() => onChange(tool)}><Icon size={18} /></button>)}
  </nav>;
}
