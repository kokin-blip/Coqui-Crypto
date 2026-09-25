import { groupChartEvidence, type ChartEvidenceItem } from './chart-evidence-groups.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';

export function ChartEvidenceList({ bars, items }: {
  readonly bars: readonly { readonly startTimeMs: number; readonly endTimeMs: number }[];
  readonly items: readonly ChartEvidenceItem[];
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  const groups = groupChartEvidence(bars, items);
  return <details className="chart-evidence-list"><summary>Chart events · {items.length} recorded in {groups.length} displayed bar{groups.length === 1 ? '' : 's'}</summary>
    <ol>{groups.map((group) => <li key={group.timeMs}>
      <strong><time dateTime={exactUtcTimestamp(group.timeMs)} title={exactUtcTimestamp(group.timeMs)}>{formatLocalTimestamp(group.timeMs)}</time> · {group.items.length} event{group.items.length === 1 ? '' : 's'}</strong>
      <ul>{group.items.map((item, index) => <li key={`${item.timeMs}:${item.label}:${index}`}><span className={`status-text status-${item.tone}`}>{item.tone}</span> {item.label} · <time dateTime={exactUtcTimestamp(item.timeMs)} title={exactUtcTimestamp(item.timeMs)}>{formatLocalTimestamp(item.timeMs)}</time></li>)}</ul>
    </li>)}</ol>
    {groups.reduce((count, group) => count + group.items.length, 0) < items.length && <p className="metric-note">Events outside displayed bars are excluded from this chart range.</p>}
  </details>;
}
