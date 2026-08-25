import { Decimal } from 'decimal.js';

import { decimal } from '../types/money.js';

const DAY_MS = 86_400_000;
const YEAR_DAYS = new Decimal(365);

export interface PaperPerformancePointInput {
  readonly dayUtc: number;
  readonly equityUsd: string | null;
  readonly benchmarkUsd: string | null;
  readonly cashFlowUsd?: string;
  readonly evidenceHash: string;
  readonly unpricedCount: number;
}

export interface ClosedPaperLotInput {
  readonly closedAt: number;
  readonly pnlUsd: string;
}

export interface PaperTradingCostInput {
  readonly notionalUsd: string;
  readonly venueFeeUsd: string;
  readonly spreadUsd: string;
  readonly slippageUsd: string;
  readonly impactUsd: string;
}

export interface PaperFillPerformanceInput extends PaperTradingCostInput {
  readonly productId: string;
  readonly side: 'buy' | 'sell';
  readonly quantity: string;
  readonly filledAt: number;
}

export interface FifoPaperLotResult {
  readonly closedLots: readonly ClosedPaperLotInput[];
  readonly unattributedOpeningBalanceExcluded: boolean;
}

export interface HoldBenchmarkPosition {
  readonly productId: string;
  readonly quantity: string;
  readonly valueUsd: string | null;
}

/** Value immutable starting quantities at current observed prices. */
export function calculateStartingPortfolioHoldBenchmark(input: {
  readonly startingCashUsd: string;
  readonly startingPositions: readonly HoldBenchmarkPosition[];
  readonly currentPositions: readonly HoldBenchmarkPosition[];
}): string | null {
  let total = new Decimal(input.startingCashUsd);
  const current = new Map(input.currentPositions.map((position) => [position.productId, position]));
  for (const starting of input.startingPositions) {
    const startingQuantity = new Decimal(starting.quantity);
    if (startingQuantity.isZero()) continue;
    const observed = current.get(starting.productId);
    if (starting.valueUsd === null || observed?.valueUsd === null || observed === undefined) return null;
    const currentQuantity = new Decimal(observed.quantity);
    if (currentQuantity.isZero()) return null;
    const currentPrice = new Decimal(observed.valueUsd).div(currentQuantity);
    total = total.add(startingQuantity.mul(currentPrice));
  }
  return text(total);
}

export interface PaperPerformancePoint {
  readonly dayUtc: number;
  readonly equityUsd: string;
  readonly benchmarkUsd: string | null;
  readonly pnlUsd: string | null;
  readonly returnPct: string | null;
  readonly drawdownPct: string;
  readonly evidenceHash: string;
}

export interface DrawdownEpisode {
  readonly peakDayUtc: number;
  readonly troughDayUtc: number;
  readonly recoveredDayUtc: number | null;
  readonly drawdownPct: string;
  readonly declineDays: number;
  readonly recoveryDays: number | null;
}

export interface PaperPerformanceMetrics {
  readonly annualizedReturnPct: string | null;
  readonly volatilityPct: string | null;
  readonly sharpe: string | null;
  readonly sortino: string | null;
  readonly calmar: string | null;
  readonly maxDrawdownPct: string;
  readonly winRatePct: string | null;
  readonly profitFactor: string | 'infinite' | null;
  readonly turnoverPct: string | null;
  readonly venueFeesUsd: string;
  readonly spreadUsd: string;
  readonly slippageUsd: string;
  readonly impactUsd: string;
  readonly timeBelowHighPct: string;
  readonly riskFreeRatePct: '0';
  readonly annualizationDays: 365;
}

export interface PaperPerformanceResult {
  readonly points: readonly PaperPerformancePoint[];
  readonly monthlyPnl: readonly { readonly month: string; readonly pnlUsd: string }[];
  readonly distribution: readonly { readonly bucket: string; readonly count: number }[];
  readonly worstDrawdowns: readonly DrawdownEpisode[];
  readonly metrics: PaperPerformanceMetrics;
  readonly exclusions: {
    readonly incompleteValuationDays: number;
    readonly missingCalendarDays: number;
    readonly unattributedOpeningBalanceExcluded: boolean;
  };
}

function text(value: Decimal, places = 8): string {
  const fixed = value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed();
  return decimal(fixed).toString();
}

function percent(value: Decimal): string {
  return text(value.mul(100), 6);
}

function mean(values: readonly Decimal[]): Decimal | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum.add(value), new Decimal(0)).div(values.length);
}

function standardDeviation(values: readonly Decimal[]): Decimal | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return values
    .reduce((sum, value) => sum.add(value.minus(average).pow(2)), new Decimal(0))
    .div(values.length - 1)
    .sqrt();
}

function distribution(returns: readonly Decimal[]) {
  const labels = ['< −5%', '−5% to −1%', '−1% to 0%', '0%', '0% to 1%', '1% to 5%', '≥ 5%'];
  const counts = new Array<number>(labels.length).fill(0);
  for (const value of returns) {
    const pct = value.mul(100);
    const index = pct.lt(-5) ? 0 : pct.lt(-1) ? 1 : pct.lt(0) ? 2
      : pct.eq(0) ? 3 : pct.lt(1) ? 4 : pct.lt(5) ? 5 : 6;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return Object.freeze(labels.map((bucket, index) => Object.freeze({ bucket, count: counts[index] ?? 0 })));
}

function drawdownEpisodes(points: readonly PaperPerformancePoint[]): readonly DrawdownEpisode[] {
  if (points.length === 0) return Object.freeze([]);
  const episodes: DrawdownEpisode[] = [];
  let peakIndex = 0;
  let troughIndex = 0;
  let active = false;
  for (let index = 1; index < points.length; index += 1) {
    const equity = new Decimal(points[index]!.equityUsd);
    const peak = new Decimal(points[peakIndex]!.equityUsd);
    if (equity.gte(peak)) {
      if (active) {
        const trough = points[troughIndex]!;
        episodes.push(Object.freeze({
          peakDayUtc: points[peakIndex]!.dayUtc,
          troughDayUtc: trough.dayUtc,
          recoveredDayUtc: points[index]!.dayUtc,
          drawdownPct: trough.drawdownPct,
          declineDays: Math.round((trough.dayUtc - points[peakIndex]!.dayUtc) / DAY_MS),
          recoveryDays: Math.round((points[index]!.dayUtc - trough.dayUtc) / DAY_MS),
        }));
      }
      peakIndex = index;
      troughIndex = index;
      active = false;
    } else if (!active || new Decimal(points[index]!.drawdownPct).lt(points[troughIndex]!.drawdownPct)) {
      troughIndex = index;
      active = true;
    }
  }
  if (active) {
    const trough = points[troughIndex]!;
    episodes.push(Object.freeze({
      peakDayUtc: points[peakIndex]!.dayUtc,
      troughDayUtc: trough.dayUtc,
      recoveredDayUtc: null,
      drawdownPct: trough.drawdownPct,
      declineDays: Math.round((trough.dayUtc - points[peakIndex]!.dayUtc) / DAY_MS),
      recoveryDays: null,
    }));
  }
  return Object.freeze(episodes.sort((left, right) =>
    new Decimal(left.drawdownPct).comparedTo(right.drawdownPct)).slice(0, 10));
}

/** FIFO realized P&L from recorded fills only; unknown opening inventory is excluded. */
export function deriveFifoPaperLots(
  fills: readonly PaperFillPerformanceInput[],
): FifoPaperLotResult {
  const queues = new Map<string, Array<{ quantity: Decimal; costUsd: Decimal }>>();
  const closedLots: ClosedPaperLotInput[] = [];
  let excluded = false;
  const ordered = [...fills].sort((left, right) => left.filledAt - right.filledAt);
  for (const fill of ordered) {
    const quantity = new Decimal(fill.quantity);
    const fee = new Decimal(fill.venueFeeUsd);
    if (fill.side === 'buy') {
      const queue = queues.get(fill.productId) ?? [];
      queue.push({ quantity, costUsd: new Decimal(fill.notionalUsd).add(fee) });
      queues.set(fill.productId, queue);
      continue;
    }
    let remaining = quantity;
    let costBasis = new Decimal(0);
    const queue = queues.get(fill.productId) ?? [];
    while (remaining.gt(0) && queue.length > 0) {
      const lot = queue[0]!;
      const used = Decimal.min(remaining, lot.quantity);
      const allocated = lot.costUsd.mul(used.div(lot.quantity));
      costBasis = costBasis.add(allocated);
      lot.quantity = lot.quantity.minus(used);
      lot.costUsd = lot.costUsd.minus(allocated);
      remaining = remaining.minus(used);
      if (lot.quantity.isZero()) queue.shift();
    }
    if (remaining.gt(0)) {
      excluded = true;
      continue;
    }
    closedLots.push(Object.freeze({
      closedAt: fill.filledAt,
      pnlUsd: text(new Decimal(fill.notionalUsd).minus(fee).minus(costBasis)),
    }));
  }
  return Object.freeze({
    closedLots: Object.freeze(closedLots),
    unattributedOpeningBalanceExcluded: excluded,
  });
}

export function calculatePaperPerformance(
  input: {
    readonly valuations: readonly PaperPerformancePointInput[];
    readonly closedLots?: readonly ClosedPaperLotInput[];
    readonly costs?: readonly PaperTradingCostInput[];
    readonly unattributedOpeningBalance?: boolean;
  },
): PaperPerformanceResult {
  const ordered = [...input.valuations].sort((left, right) => left.dayUtc - right.dayUtc);
  const complete = ordered.filter((point) => point.equityUsd !== null && point.unpricedCount === 0);
  const points: PaperPerformancePoint[] = [];
  const returns: Decimal[] = [];
  let peak: Decimal | null = null;
  for (const point of complete) {
    const equity = new Decimal(point.equityUsd!);
    peak = peak === null || equity.gt(peak) ? equity : peak;
    const previous = complete[points.length - 1];
    const cashFlow = new Decimal(point.cashFlowUsd ?? '0');
    const pnl = previous === undefined ? null : equity.minus(previous.equityUsd!).minus(cashFlow);
    const dailyReturn = previous === undefined || new Decimal(previous.equityUsd!).isZero()
      ? null
      : pnl!.div(previous.equityUsd!);
    if (dailyReturn !== null) returns.push(dailyReturn);
    points.push(Object.freeze({
      dayUtc: point.dayUtc,
      equityUsd: text(equity),
      benchmarkUsd: point.benchmarkUsd === null ? null : text(new Decimal(point.benchmarkUsd)),
      pnlUsd: pnl === null ? null : text(pnl),
      returnPct: dailyReturn === null ? null : percent(dailyReturn),
      drawdownPct: percent(equity.div(peak).minus(1)),
      evidenceHash: point.evidenceHash,
    }));
  }

  const monthly = new Map<string, Decimal>();
  for (const point of points) {
    if (point.pnlUsd === null) continue;
    const month = new Date(point.dayUtc).toISOString().slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? new Decimal(0)).add(point.pnlUsd));
  }
  const episodes = drawdownEpisodes(points);
  const maxDrawdown = episodes[0] === undefined ? new Decimal(0) : new Decimal(episodes[0].drawdownPct).div(100);
  const average = mean(returns);
  const volatility = standardDeviation(returns);
  const downside = returns.length === 0 ? null : returns
    .reduce((sum, value) => sum.add(Decimal.min(value, 0).pow(2)), new Decimal(0))
    .div(returns.length).sqrt();
  const spanDays = points.length < 2 ? 0
    : Math.max(1, (points.at(-1)!.dayUtc - points[0]!.dayUtc) / DAY_MS);
  const annualizedReturn = points.length < 2 || new Decimal(points[0]!.equityUsd).isZero()
    ? null
    : new Decimal(points.at(-1)!.equityUsd)
      .div(points[0]!.equityUsd).pow(YEAR_DAYS.div(spanDays)).minus(1);
  const sqrtYear = YEAR_DAYS.sqrt();
  const closed = input.closedLots ?? [];
  const wins = closed.filter((lot) => new Decimal(lot.pnlUsd).gt(0));
  const gains = wins.reduce((sum, lot) => sum.add(lot.pnlUsd), new Decimal(0));
  const losses = closed.filter((lot) => new Decimal(lot.pnlUsd).lt(0))
    .reduce((sum, lot) => sum.add(new Decimal(lot.pnlUsd).abs()), new Decimal(0));
  const costs = input.costs ?? [];
  const sumCost = (key: keyof PaperTradingCostInput) => costs
    .reduce((sum, item) => sum.add(item[key]), new Decimal(0));
  const turnover = sumCost('notionalUsd');
  const averageEquity = mean(points.map((point) => new Decimal(point.equityUsd)));
  const calendarSpan = ordered.length < 2 ? ordered.length
    : Math.round((ordered.at(-1)!.dayUtc - ordered[0]!.dayUtc) / DAY_MS) + 1;
  const belowHigh = points.filter((point) => new Decimal(point.drawdownPct).lt(0)).length;

  return Object.freeze({
    points: Object.freeze(points),
    monthlyPnl: Object.freeze([...monthly].map(([month, pnlUsd]) => Object.freeze({ month, pnlUsd: text(pnlUsd) }))),
    distribution: distribution(returns),
    worstDrawdowns: episodes,
    metrics: Object.freeze({
      annualizedReturnPct: annualizedReturn === null ? null : percent(annualizedReturn),
      volatilityPct: volatility === null ? null : percent(volatility.mul(sqrtYear)),
      sharpe: volatility === null || volatility.isZero() || average === null
        ? null : text(average.div(volatility).mul(sqrtYear), 6),
      sortino: downside === null || downside.isZero() || average === null
        ? null : text(average.div(downside).mul(sqrtYear), 6),
      calmar: annualizedReturn === null || maxDrawdown.isZero()
        ? null : text(annualizedReturn.div(maxDrawdown.abs()), 6),
      maxDrawdownPct: percent(maxDrawdown),
      winRatePct: closed.length === 0 ? null : percent(new Decimal(wins.length).div(closed.length)),
      profitFactor: closed.length === 0 ? null : losses.isZero()
        ? gains.isZero() ? null : 'infinite'
        : text(gains.div(losses), 6),
      turnoverPct: averageEquity === null || averageEquity.isZero()
        ? null : percent(turnover.div(averageEquity)),
      venueFeesUsd: text(sumCost('venueFeeUsd')),
      spreadUsd: text(sumCost('spreadUsd')),
      slippageUsd: text(sumCost('slippageUsd')),
      impactUsd: text(sumCost('impactUsd')),
      timeBelowHighPct: points.length === 0 ? '0' : percent(new Decimal(belowHigh).div(points.length)),
      riskFreeRatePct: '0',
      annualizationDays: 365,
    }),
    exclusions: Object.freeze({
      incompleteValuationDays: ordered.length - complete.length,
      missingCalendarDays: Math.max(0, calendarSpan - ordered.length),
      unattributedOpeningBalanceExcluded: input.unattributedOpeningBalance ?? false,
    }),
  });
}
