/** Simple moving average of the last `period` values, or null if too short. */
export function sma(values: readonly number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let index = values.length - period; index < values.length; index++) {
    sum += values[index]!;
  }
  return sum / period;
}

/** Wilder's RSI over `period` (default 14), in [0, 100]. */
export function rsi(closes: readonly number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const delta = closes[index]! - closes[index - 1]!;
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  for (let index = period + 1; index < closes.length; index++) {
    const delta = closes[index]! - closes[index - 1]!;
    const currentGain = delta >= 0 ? delta : 0;
    const currentLoss = delta < 0 ? -delta : 0;
    averageGain = (averageGain * (period - 1) + currentGain) / period;
    averageLoss = (averageLoss * (period - 1) + currentLoss) / period;
  }
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

/** Annualized realized volatility (%) from the last daily-return window. */
export function realizedVolatilityPct(
  closes: readonly number[],
  lookback = 30,
): number | null {
  if (closes.length < lookback + 1) return null;
  const returns: number[] = [];
  for (let index = closes.length - lookback; index < closes.length; index++) {
    const previous = closes[index - 1]!;
    if (previous > 0) returns.push((closes[index]! - previous) / previous);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}
