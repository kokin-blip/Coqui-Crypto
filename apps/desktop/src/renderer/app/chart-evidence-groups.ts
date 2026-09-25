export interface ChartEvidenceItem {
  readonly timeMs: number;
  readonly label: string;
  readonly tone: 'neutral' | 'positive' | 'negative' | 'warning';
}

export interface ChartEvidenceGroup<T extends ChartEvidenceItem> {
  readonly timeMs: number;
  readonly tone: ChartEvidenceItem['tone'];
  readonly items: readonly T[];
}

/** One chart marker per displayed bar; the full event list stays available beside the chart. */
export function groupChartEvidence<T extends ChartEvidenceItem>(
  bars: readonly { readonly startTimeMs: number; readonly endTimeMs: number }[],
  items: readonly T[],
): readonly ChartEvidenceGroup<T>[] {
  const byBar = new Map<number, T[]>();
  for (const item of items) {
    const bar = bars.find((candidate) => candidate.startTimeMs <= item.timeMs && item.timeMs < candidate.endTimeMs);
    if (bar === undefined) continue;
    const group = byBar.get(bar.startTimeMs) ?? [];
    group.push(item);
    byBar.set(bar.startTimeMs, group);
  }
  const priority = { negative: 3, warning: 2, positive: 1, neutral: 0 } as const;
  return [...byBar].sort(([a], [b]) => a - b).map(([timeMs, grouped]) => ({
    timeMs, items: grouped,
    tone: grouped.reduce<ChartEvidenceItem['tone']>((tone, item) => priority[item.tone] > priority[tone] ? item.tone : tone, 'neutral'),
  }));
}
