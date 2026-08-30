export interface IndicatorInput { readonly day: string; readonly close: number }
export interface IndicatorPoint { readonly day: string; readonly value: number }
export interface BollingerPoint extends IndicatorPoint { readonly upper: number; readonly lower: number }
export interface MacdPoint extends IndicatorPoint { readonly signal: number; readonly histogram: number }

const round = (value: number): number => Number(value.toFixed(10));

export function sma(input: readonly IndicatorInput[], period: number): readonly IndicatorPoint[] {
  if (!Number.isInteger(period) || period < 1 || input.length < period) return [];
  let sum = 0;
  const output: IndicatorPoint[] = [];
  for (let index = 0; index < input.length; index += 1) {
    sum += input[index]!.close;
    if (index >= period) sum -= input[index - period]!.close;
    if (index >= period - 1) output.push({ day: input[index]!.day, value: round(sum / period) });
  }
  return output;
}

export function ema(input: readonly IndicatorInput[], period: number): readonly IndicatorPoint[] {
  if (!Number.isInteger(period) || period < 1 || input.length < period) return [];
  const seed = input.slice(0, period).reduce((sum, item) => sum + item.close, 0) / period;
  const multiplier = 2 / (period + 1);
  let current = seed;
  const output: IndicatorPoint[] = [{ day: input[period - 1]!.day, value: round(current) }];
  for (let index = period; index < input.length; index += 1) {
    current = (input[index]!.close - current) * multiplier + current;
    output.push({ day: input[index]!.day, value: round(current) });
  }
  return output;
}

export function bollinger(input: readonly IndicatorInput[], period = 20, deviations = 2): readonly BollingerPoint[] {
  return sma(input, period).map((mean, offset) => {
    const window = input.slice(offset, offset + period);
    const variance = window.reduce((sum, item) => sum + (item.close - mean.value) ** 2, 0) / period;
    const width = Math.sqrt(variance) * deviations;
    return { ...mean, upper: round(mean.value + width), lower: round(mean.value - width) };
  });
}

export function rsi(input: readonly IndicatorInput[], period = 14): readonly IndicatorPoint[] {
  if (input.length <= period) return [];
  let gain = 0; let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = input[index]!.close - input[index - 1]!.close;
    gain += Math.max(change, 0); loss += Math.max(-change, 0);
  }
  let averageGain = gain / period; let averageLoss = loss / period;
  const value = (): number => averageLoss === 0 ? 100 : round(100 - (100 / (1 + averageGain / averageLoss)));
  const output: IndicatorPoint[] = [{ day: input[period]!.day, value: value() }];
  for (let index = period + 1; index < input.length; index += 1) {
    const change = input[index]!.close - input[index - 1]!.close;
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
    output.push({ day: input[index]!.day, value: value() });
  }
  return output;
}

export function macd(input: readonly IndicatorInput[]): readonly MacdPoint[] {
  const fast = new Map(ema(input, 12).map((point) => [point.day, point.value]));
  const slow = ema(input, 26);
  const line = slow.flatMap((point) => fast.has(point.day) ? [{ day: point.day, close: round(fast.get(point.day)! - point.value) }] : []);
  const signal = new Map(ema(line, 9).map((point) => [point.day, point.value]));
  return line.flatMap((point) => signal.has(point.day) ? [{ day: point.day, value: point.close, signal: signal.get(point.day)!, histogram: round(point.close - signal.get(point.day)!) }] : []);
}
