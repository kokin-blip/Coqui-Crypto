export type ChartRange = '1d' | '1w' | '1m' | '3m' | '1y' | 'all';

const RANGE_DAYS: Readonly<Record<Exclude<ChartRange, 'all'>, number>> = {
  '1d': 1,
  '1w': 7,
  '1m': 31,
  '3m': 93,
  '1y': 365,
};

export function rangeLookbackDays(range: ChartRange, maximum = 1825): number {
  return range === 'all' ? maximum : RANGE_DAYS[range];
}

export function filterPointsByRange<T extends { readonly day: string }>(
  points: readonly T[],
  range: ChartRange,
): readonly T[] {
  if (range === 'all' || points.length === 0) return points;
  const latest = Date.parse(`${points.at(-1)!.day}T00:00:00.000Z`);
  const earliest = latest - ((rangeLookbackDays(range) - 1) * 86_400_000);
  return points.filter((point) => Date.parse(`${point.day}T00:00:00.000Z`) >= earliest);
}
