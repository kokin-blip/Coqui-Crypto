export interface AllocationDatum {
  readonly id: string;
  readonly label: string;
  readonly valueUsd: string;
}

export interface WeightedAllocationDatum extends AllocationDatum {
  readonly value: number;
  readonly percent: number;
}

function decimalUnits(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(value);
  if (match === null) return null;
  const fraction = (match[2] ?? '').slice(0, 8).padEnd(8, '0');
  return (BigInt(match[1]!) * 100_000_000n) + BigInt(fraction);
}

export function allocationPercentages(
  data: readonly AllocationDatum[],
): readonly WeightedAllocationDatum[] {
  const parsed = data.map((datum) => ({ datum, units: decimalUnits(datum.valueUsd) }))
    .filter((entry): entry is { datum: AllocationDatum; units: bigint } =>
      entry.units !== null && entry.units > 0n);
  const total = parsed.reduce((sum, entry) => sum + entry.units, 0n);
  if (total === 0n) return [];
  return parsed.map(({ datum, units }) => ({
    ...datum,
    value: Number((units * 1_000_000n) / total) / 10_000,
    percent: Number((units * 1_000_000n) / total) / 10_000,
  }));
}

/** Asset identity, rather than row position, keeps colors stable across views. */
export function allocationColor(id: string): string {
  const symbol = id.trim().toUpperCase();
  if (symbol === 'BTC') return 'var(--coqui-positive)';
  if (symbol === 'USD') return 'var(--coqui-info)';
  const colors = ['var(--coqui-warning)', 'var(--coqui-info)', 'var(--coqui-positive)', 'var(--coqui-negative)', 'var(--coqui-advisory)'];
  let hash = 0;
  for (const character of symbol) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length]!;
}
