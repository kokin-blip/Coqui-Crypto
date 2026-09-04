import { Link2, Unlink2, X } from 'lucide-react';

import type {
  ChartTileConfiguration, WorkstationInterval,
} from './chart-workstation-types.js';

const INTERVALS: readonly WorkstationInterval[] = ['1m', '5m', '15m', '1h', '6h', '1d'];

export function MarketChartTileHeader({ tile, products, liveVisible, onChange, onToggleLink }: {
  readonly tile: ChartTileConfiguration;
  readonly products: readonly { readonly productId: string; readonly label: string }[];
  readonly liveVisible: boolean;
  readonly onChange: (patch: Partial<ChartTileConfiguration>) => void;
  readonly onToggleLink: () => void;
}): React.JSX.Element {
  const availableComparisons = products.filter((item) => item.productId !== tile.productId &&
    !tile.compareProductIds.includes(item.productId));
  return <div className="chart-tile-label">
    <div className="chart-tile-selectors">
      <label><span className="sr-only">Chart product</span><select value={tile.productId}
        onChange={(event) => onChange({ productId: event.target.value,
          compareProductIds: tile.compareProductIds.filter((id) => id !== event.target.value) })}>
        {products.map((item) => <option key={item.productId} value={item.productId}>{item.label}</option>)}
      </select></label>
      <label><span className="sr-only">Chart interval</span><select value={tile.interval}
        onChange={(event) => onChange({ interval: event.target.value as WorkstationInterval })}>
        {INTERVALS.map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <small>{liveVisible ? 'live candle visible' : 'completed only'}</small>
    </div>
    <div className="chart-tile-actions">
      {tile.compareProductIds.map((productId) => <button key={productId} type="button"
        className="compare-chip" aria-label={`Remove ${productId} comparison`}
        onClick={() => onChange({ compareProductIds: tile.compareProductIds.filter((id) => id !== productId) })}>
        {productId}<X size={10} />
      </button>)}
      {tile.compareProductIds.length < 3 && <label className="compare-picker"><span className="sr-only">Add comparison</span>
        <select value="" onChange={(event) => {
          if (event.target.value !== '') onChange({ compareProductIds: [...tile.compareProductIds, event.target.value], scaleMode: 'percentage' });
        }}><option value="">+ Compare</option>{availableComparisons.map((item) =>
          <option key={item.productId} value={item.productId}>{item.label}</option>)}</select>
      </label>}
      <button type="button" className="chart-link-toggle"
        aria-label={`${tile.linkGroup === null ? 'Link' : 'Unlink'} ${tile.productId} chart`}
        aria-pressed={tile.linkGroup !== null} onClick={onToggleLink}>
        {tile.linkGroup === null ? <Unlink2 size={13} /> : <Link2 size={13} />}
        <span>{tile.linkGroup === null ? 'Independent' : 'Linked'}</span>
      </button>
    </div>
  </div>;
}
