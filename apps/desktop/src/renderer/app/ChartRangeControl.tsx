import { useWorkspace } from './WorkspaceContext.js';
import type { ChartRange } from './chart-range.js';

export { filterPointsByRange, rangeLookbackDays } from './chart-range.js';
export type { ChartRange } from './chart-range.js';
export type ChartRangeSurface = 'overview' | 'portfolio' | 'markets' | 'performance';

const OPTIONS: readonly { readonly value: ChartRange; readonly label: string }[] = [
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

export function ChartRangeControl({ surface }: {
  readonly surface: ChartRangeSurface;
}): React.JSX.Element {
  const workspace = useWorkspace();
  const ranges = workspace.preferences?.chartRanges ?? {
    overview: '1y', portfolio: '1y', markets: '1y', performance: '1y',
  };
  const value = ranges[surface];
  return (
    <div className="chart-range-control" role="group" aria-label={`${surface} chart range`}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={workspace.pending}
          onClick={() => void workspace.update({ chartRanges: { ...ranges, [surface]: option.value } })}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
