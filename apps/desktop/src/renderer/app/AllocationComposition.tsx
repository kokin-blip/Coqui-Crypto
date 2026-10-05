import { AllocationLegend, type AllocationLegendDatum } from './AllocationLegend.js';
import { allocationColor } from './allocation-data.js';

/** Percentages are supplied by the accounting channel, never recomputed from values. */
export function AllocationComposition({ data, selectedId, onSelect }: {
  readonly data: readonly AllocationLegendDatum[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}): React.JSX.Element {
  return <figure className="allocation-composition">
    <div className="allocation-composition-bar" role="group" aria-label="Actual accounting allocation">
      {data.filter((entry) => entry.percent > 0).map((entry) => <button
        key={entry.id} type="button" aria-label={`${entry.label}: ${entry.percent.toFixed(1)}%`}
        aria-pressed={selectedId === entry.id} onClick={() => onSelect(entry.id)}
        style={{ width: `${entry.percent}%`, backgroundColor: allocationColor(entry.id) }}
      />)}
    </div>
    <figcaption><AllocationLegend data={data} selectedId={selectedId} onSelect={onSelect} /></figcaption>
  </figure>;
}
