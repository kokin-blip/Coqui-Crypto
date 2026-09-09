import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { formatUsd } from '@coqui/ui-kit';

import { allocationPercentages, type AllocationDatum, type WeightedAllocationDatum } from './allocation-data.js';
import { routeHash } from './routes.js';
import { SurfaceState } from './SurfaceState.js';

export type { AllocationDatum } from './allocation-data.js';

const COLORS = ['#43e08a', '#8b7cff', '#f2b84b', '#57c7e3', '#ff8f70', '#b8d86b'];

export default function AllocationRingChart({
  data,
  onSelect,
  selectedId,
}: {
  readonly data: readonly AllocationDatum[];
  readonly onSelect?: (id: string) => void;
  readonly selectedId?: string | null;
}): React.JSX.Element {
  const weighted = [...allocationPercentages(data)];
  if (weighted.length === 0) return <SurfaceState kind="empty" title="No priced connected holdings" detail="Sync Coinbase or Robinhood to build the active profile allocation." action={{ label: 'Open connections', href: routeHash('settings') }} compact />;
  const summary = weighted.map((entry) => `${entry.label} ${entry.percent.toFixed(1)}%`).join(', ');

  return (
    <figure className="allocation-ring">
      <div className="allocation-ring-visual" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={weighted}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="var(--coqui-canvas)"
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(entry) => {
                const selected = entry.payload as WeightedAllocationDatum | undefined;
                if (selected !== undefined) onSelect?.(selected.id);
              }}
            >
              {weighted.map((entry, index) => (
                <Cell
                  key={entry.id}
                  fill={COLORS[index % COLORS.length]!}
                  opacity={selectedId === null || selectedId === undefined || selectedId === entry.id ? 1 : 0.36}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(_value, _name, item) => {
                const datum = item.payload as WeightedAllocationDatum;
                return [`${datum.percent.toFixed(1)}% · ${formatUsd(datum.valueUsd)?.text ?? datum.valueUsd}`, datum.label];
              }}
              contentStyle={{ background: 'var(--coqui-surface-2)', border: '1px solid var(--coqui-border)', borderRadius: 8 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        <span className="sr-only">Portfolio allocation: {summary}.</span>
        <ul className="allocation-legend">
          {weighted.map((entry, index) => (
            <li key={entry.id}>
              <button type="button" aria-pressed={selectedId === entry.id} onClick={() => onSelect?.(entry.id)}>
                <i style={{ backgroundColor: COLORS[index % COLORS.length] }} aria-hidden="true" />
                <span>{entry.label}</span><strong>{entry.percent.toFixed(1)}%</strong>
              </button>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
