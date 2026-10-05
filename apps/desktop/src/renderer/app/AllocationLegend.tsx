import { formatUsd } from '@coqui/ui-kit';

import { allocationColor, type AllocationDatum } from './allocation-data.js';

export interface AllocationLegendDatum extends AllocationDatum {
  readonly percent: number;
}

export function AllocationLegend({ data, selectedId, onSelect }: {
  readonly data: readonly AllocationLegendDatum[];
  readonly selectedId?: string | null | undefined;
  readonly onSelect?: ((id: string) => void) | undefined;
}): React.JSX.Element {
  return <ul className="allocation-legend">
    {data.map((entry) => {
      const content = <><i style={{ backgroundColor: allocationColor(entry.id) }} aria-hidden="true" />
        <span className="allocation-legend-name">{entry.label}</span>
        <strong className="tabular-nums">{entry.percent.toFixed(1)}%</strong>
        <span className="allocation-legend-value tabular-nums">{formatUsd(entry.valueUsd)?.text ?? 'Unavailable'}</span></>;
      return <li key={entry.id}>{onSelect === undefined
        ? <div className="allocation-legend-row">{content}</div>
        : <button type="button" className="allocation-legend-row" aria-pressed={selectedId === entry.id} onClick={() => onSelect(entry.id)}>{content}</button>}</li>;
    })}
  </ul>;
}
