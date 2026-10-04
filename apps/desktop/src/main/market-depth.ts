/** Exact fixed-point arithmetic for informational market depth. */
export interface DepthLevel { readonly price: string; readonly size: string }
export interface CumulativeLevel extends DepthLevel { readonly total: string }

export function validDecimal(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value);
}

function units(value: string, scale: number): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(scale, '0'));
}

function scaleOf(value: string): number { return value.split('.')[1]?.length ?? 0; }

function decimal(value: bigint, scale: number): string {
  const raw = value.toString().padStart(scale + 1, '0');
  if (scale === 0) return raw;
  const fraction = raw.slice(-scale).replace(/0+$/u, '');
  return raw.slice(0, -scale) + (fraction.length === 0 ? '' : `.${fraction}`);
}

export function comparePrice(a: string, b: string): number {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const left = units(a, scale), right = units(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sumSize(a: string, b: string): string {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return decimal(units(a, scale) + units(b, scale), scale);
}

export function canonicalPrice(value: string): string { return decimal(units(value, scaleOf(value)), scaleOf(value)); }

export function aggregateDepth(levels: readonly DepthLevel[], increment: string, side: 'bid' | 'ask', limit: number): readonly CumulativeLevel[] {
  if (!validDecimal(increment) || comparePrice(increment, '0') <= 0) throw new TypeError('Invalid depth increment');
  const buckets = new Map<string, string>();
  for (const level of levels) {
    const scale = Math.max(scaleOf(level.price), scaleOf(increment));
    const step = units(increment, scale), value = units(level.price, scale);
    const bucket = side === 'bid' ? value / step : (value + step - 1n) / step;
    const price = decimal(bucket * step, scale);
    buckets.set(price, sumSize(buckets.get(price) ?? '0', level.size));
  }
  let total = '0';
  return [...buckets].sort(([a], [b]) => comparePrice(a, b) * (side === 'bid' ? -1 : 1)).slice(0, limit)
    .map(([price, size]) => { total = sumSize(total, size); return { price, size, total }; });
}
