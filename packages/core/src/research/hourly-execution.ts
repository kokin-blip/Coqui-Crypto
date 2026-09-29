import { Decimal } from 'decimal.js';

/** Frozen research policy. Changing a field requires a new candidate and study. */
export const HOURLY_EXECUTION_V1 = Object.freeze({
  id: 'trendvol-hourly-execution-v1', cadenceMinutes: 60, windowMinutes: 15,
  cooldownMinutes: 120, dailyDrift: 0.05, intradayDrift: 0.01,
  minimumTradeUsd: 25, takerFeeRate: 0.0025, slippageRate: 0.0015,
  quoteMaximumAgeMs: 60_000,
});

export interface HourlyExecutionObservation {
  readonly slotMs: number;
  readonly capturedAtMs: number;
  readonly decisionDay: string;
  readonly datasetHash: string;
  readonly targetHash: string;
  readonly targets: readonly number[];
  readonly quotes: readonly { readonly bid: number; readonly ask: number; readonly atMs: number }[];
  readonly assets: readonly { readonly tradable: boolean; readonly status: string;
    readonly minOrderSize: string; readonly minTradeIncrement: string }[];
}

export interface HourlyVirtualOrder {
  readonly id: string; readonly assetIndex: number; readonly side: 'buy' | 'sell';
  readonly quantity: number; readonly filledQuantity: number; readonly remainingQuantity: number;
  readonly price: number; readonly feeUsd: number; readonly spreadUsd: number;
  readonly slippageUsd: number; readonly partial: boolean;
}
export interface HourlyVirtualPending {
  readonly id: string; readonly assetIndex: number; readonly side: 'buy' | 'sell';
  readonly remainingQuantity: number;
}
export interface HourlyVirtualState {
  readonly cash: number;
  readonly quantities: readonly number[];
  readonly lastOrderAtMs: readonly (number | null)[];
  readonly pending: readonly HourlyVirtualPending[];
}
export interface HourlyVirtualResult {
  readonly state: HourlyVirtualState;
  readonly orders: readonly HourlyVirtualOrder[];
  readonly blocked: readonly { readonly assetIndex: number; readonly reason: string }[];
  readonly equityUsd: number;
  readonly turnoverUsd: number;
  readonly feesUsd: number;
  readonly spreadUsd: number;
  readonly slippageUsd: number;
}

export function hourlySlotAt(nowMs: number, cadenceMinutes = HOURLY_EXECUTION_V1.cadenceMinutes): number | null {
  if (!Number.isSafeInteger(cadenceMinutes) || cadenceMinutes < 30 || 1440 % cadenceMinutes !== 0 ||
      !Number.isFinite(nowMs)) return null;
  const slotMs = Math.floor(nowMs / (cadenceMinutes * 60_000)) * cadenceMinutes * 60_000;
  return nowMs - slotMs < HOURLY_EXECUTION_V1.windowMinutes * 60_000 ? slotMs : null;
}

export function validateHourlyObservation(row: HourlyExecutionObservation): void {
  const { slotMs, capturedAtMs } = row;
  if (!Number.isSafeInteger(slotMs) || slotMs % 3_600_000 !== 0 ||
      !Number.isSafeInteger(capturedAtMs) || capturedAtMs < slotMs ||
      capturedAtMs - slotMs >= HOURLY_EXECUTION_V1.windowMinutes * 60_000 ||
      row.decisionDay !== new Date(slotMs - 86_400_000).toISOString().slice(0, 10) ||
      !/^[a-f0-9]{64}$/u.test(row.datasetHash) || !/^[a-f0-9]{64}$/u.test(row.targetHash) ||
      row.targets.length !== 3 || row.quotes.length !== 3 || row.assets.length !== 3 ||
      row.targets.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
      row.targets.reduce((sum, value) => sum + value, 0) > 1.00000001) throw new Error('invalid_hourly_observation');
  for (const [index, quote] of row.quotes.entries()) {
    const asset = row.assets[index]!;
    if (!Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) || quote.bid <= 0 || quote.ask < quote.bid ||
        !Number.isSafeInteger(quote.atMs) || quote.atMs > capturedAtMs + 5_000 ||
        capturedAtMs - quote.atMs > HOURLY_EXECUTION_V1.quoteMaximumAgeMs ||
        !asset.tradable || asset.status !== 'active' ||
        !new Decimal(asset.minOrderSize).isPositive() || !new Decimal(asset.minTradeIncrement).isPositive()) {
      throw new Error('stale_or_ineligible_hourly_evidence');
    }
  }
}

export function openingHourlyState(cash: number, quantities: readonly number[]): HourlyVirtualState {
  if (!Number.isFinite(cash) || cash < 0 || quantities.length !== 3 ||
      quantities.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('invalid_hourly_opening');
  return { cash, quantities: [...quantities], lastOrderAtMs: [null, null, null], pending: [] };
}

/** Credential-free, deterministic market-order model; never submits to Alpaca. */
export function advanceHourlyExecution(input: {
  readonly observation: HourlyExecutionObservation;
  readonly state: HourlyVirtualState;
  readonly policy: 'daily-plus-four-hour' | 'trendvol-hourly-execution-v1';
  readonly costMultiplier?: number;
  /** Functional partial-fill injection. Production research uses immediate fills (1). */
  readonly fillFraction?: number;
}): HourlyVirtualResult {
  const { observation: row, policy } = input;
  validateHourlyObservation(row);
  const multiplier = input.costMultiplier ?? 1, fraction = input.fillFraction ?? 1;
  if (!Number.isFinite(multiplier) || multiplier <= 0 || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 ||
      input.state.quantities.length !== 3 || input.state.lastOrderAtMs.length !== 3) throw new Error('invalid_hourly_replay');
  const mids = row.quotes.map((q) => (q.bid + q.ask) / 2);
  const quantities = [...input.state.quantities], lastOrderAtMs = [...input.state.lastOrderAtMs];
  const pending: HourlyVirtualPending[] = [];
  const orders: HourlyVirtualOrder[] = [], blocked: { assetIndex: number; reason: string }[] = [];
  let cash = input.state.cash, turnoverUsd = 0, feesUsd = 0, spreadUsd = 0, slippageUsd = 0;
  const execute = (index: number, side: 'buy' | 'sell', desired: number, id: string): number => {
    const quote = row.quotes[index]!, mid = mids[index]!;
    const spread = (quote.ask - quote.bid) / 2 * multiplier;
    const slip = mid * HOURLY_EXECUTION_V1.slippageRate * multiplier;
    const feeRate = HOURLY_EXECUTION_V1.takerFeeRate * multiplier;
    const price = mid + (side === 'buy' ? 1 : -1) * (spread + slip);
    if (price <= 0) throw new Error('invalid_stressed_fill_price');
    const fill = Math.min(desired * fraction, side === 'sell' ? quantities[index]! : cash / price);
    if (fill > 0) {
      if (side === 'buy') { cash -= fill * price; quantities[index] = quantities[index]! + fill * (1 - feeRate); }
      else { cash += fill * price * (1 - feeRate); quantities[index] = quantities[index]! - fill; }
      turnoverUsd += fill * price; feesUsd += fill * price * feeRate;
      spreadUsd += fill * spread; slippageUsd += fill * slip;
      lastOrderAtMs[index] = row.slotMs;
    }
    const remaining = Math.max(0, desired - fill);
    if (remaining > 1e-10) pending.push({ id, assetIndex: index, side, remainingQuantity: remaining });
    orders.push({ id, assetIndex: index, side, quantity: desired, filledQuantity: fill,
      remainingQuantity: remaining, price, feeUsd: fill * price * feeRate,
      spreadUsd: fill * spread, slippageUsd: fill * slip, partial: remaining > 1e-10 });
    return fill;
  };
  for (const prior of input.state.pending) execute(prior.assetIndex, prior.side,
    prior.remainingQuantity, prior.id);
  const hasPending = new Set(pending.map((order) => order.assetIndex));
  const equity = cash + quantities.reduce((sum, qty, index) => sum + qty * mids[index]!, 0);
  const hour = new Date(row.slotMs).getUTCHours();
  const scheduled = policy === 'trendvol-hourly-execution-v1' || hour === 0 || hour % 4 === 0;
  const band = hour === 0 ? HOURLY_EXECUTION_V1.dailyDrift : HOURLY_EXECUTION_V1.intradayDrift;
  const deltas = row.targets.map((target, index) => ({ index,
    delta: equity * target / mids[index]! - quantities[index]! })).sort((a, b) => a.delta - b.delta);
  for (const { index, delta } of deltas) {
    const mid = mids[index]!, asset = row.assets[index]!;
    if (equity <= 0 || Math.abs(delta * mid) / equity < band || Math.abs(delta * mid) < HOURLY_EXECUTION_V1.minimumTradeUsd) continue;
    if (!scheduled) { blocked.push({ assetIndex: index, reason: 'cadence' }); continue; }
    if (hasPending.has(index) || input.state.pending.some((order) => order.assetIndex === index)) {
      blocked.push({ assetIndex: index, reason: 'pending' }); continue;
    }
    const last = lastOrderAtMs[index];
    if (policy === 'trendvol-hourly-execution-v1' && last != null &&
        row.slotMs - last < HOURLY_EXECUTION_V1.cooldownMinutes * 60_000) {
      blocked.push({ assetIndex: index, reason: 'cooldown' }); continue;
    }
    const side = delta < 0 ? 'sell' : 'buy';
    const capped = side === 'sell' ? Math.min(-delta, quantities[index]!) :
      Math.min(delta, cash / (mid * 1.01));
    const increment = new Decimal(asset.minTradeIncrement);
    const qty = new Decimal(Math.max(0, capped)).div(increment).floor().mul(increment).toNumber();
    if (qty < Number(asset.minOrderSize) || qty * mid < HOURLY_EXECUTION_V1.minimumTradeUsd) {
      blocked.push({ assetIndex: index, reason: 'order_increment_or_minimum' }); continue;
    }
    execute(index, side, qty, `${policy}:${row.slotMs}:${side}:${index}`);
  }
  return { state: { cash: Math.max(0, cash), quantities, lastOrderAtMs, pending }, orders,
    blocked, equityUsd: cash + quantities.reduce((sum, qty, index) => sum + qty * mids[index]!, 0),
    turnoverUsd, feesUsd, spreadUsd, slippageUsd };
}

/** Compare both cadences on one complete, chronological hourly tape and the same opening book. */
export function replayHourlyExecution(tape: readonly HourlyExecutionObservation[],
  opening: HourlyVirtualState, costMultiplier = 1) {
  if (tape.length === 0 || tape.length % 24 !== 0) return { status: 'incomplete_days' as const, results: [] };
  let prior: HourlyExecutionObservation | null = null;
  try {
    for (const [index, row] of tape.entries()) {
      validateHourlyObservation(row);
      if (index === 0 && new Date(row.slotMs).getUTCHours() !== 0) throw new Error('incomplete_days');
      if (prior !== null && (row.slotMs - prior.slotMs !== 3_600_000 ||
          (new Date(row.slotMs).getUTCHours() !== 0 &&
            (row.targetHash !== prior.targetHash || row.datasetHash !== prior.datasetHash ||
              row.targets.some((value, asset) => Math.abs(value - prior!.targets[asset]!) > 1e-12))))) {
        throw new Error('invalid_or_gapped_hourly_tape');
      }
      prior = row;
    }
  } catch (error) {
    return { status: error instanceof Error && error.message === 'incomplete_days'
      ? 'incomplete_days' as const : 'invalid_or_gapped_hourly_tape' as const, results: [] };
  }
  const results = (['daily-plus-four-hour', HOURLY_EXECUTION_V1.id] as const).map((policy) => {
    let state = openingHourlyState(opening.cash, opening.quantities);
    let turnoverUsd = 0, feesUsd = 0, spreadUsd = 0, slippageUsd = 0;
    let blockedOrders = 0, missedOrders = 0, partialFillsModeled = 0;
    const orderIds = new Set<string>();
    const blockedByReason: Record<string, number> = {};
    const equityCurve: number[] = [];
    const openingEquity = opening.cash + opening.quantities.reduce((sum, qty, index) =>
      sum + qty * (tape[0]!.quotes[index]!.bid + tape[0]!.quotes[index]!.ask) / 2, 0);
    let peak = openingEquity, maxDrawdown = 0;
    for (const row of tape) {
      const step = advanceHourlyExecution({ observation: row, state, policy, costMultiplier });
      state = step.state;
      turnoverUsd += step.turnoverUsd; feesUsd += step.feesUsd;
      spreadUsd += step.spreadUsd; slippageUsd += step.slippageUsd;
      for (const order of step.orders) orderIds.add(order.id);
      partialFillsModeled += step.orders.filter((order) => order.partial).length;
      blockedOrders += step.blocked.length;
      missedOrders += step.blocked.filter((item) => item.reason === 'cadence' || item.reason === 'cooldown').length;
      for (const item of step.blocked) blockedByReason[item.reason] = (blockedByReason[item.reason] ?? 0) + 1;
      peak = Math.max(peak, step.equityUsd);
      maxDrawdown = Math.min(maxDrawdown, step.equityUsd / peak - 1);
      equityCurve.push(step.equityUsd);
    }
    return { policy, openingEquityUsd: openingEquity, endingEquityUsd: equityCurve.at(-1)!,
      netReturn: equityCurve.at(-1)! / openingEquity - 1, maxDrawdown, turnoverUsd,
      feesUsd, spreadUsd, slippageUsd, orders: orderIds.size, blockedOrders, missedOrders,
      blockedByReason, partialFillsModeled, unresolvedModeledOrders: state.pending.length,
      observedAlpacaPartialFills: null, equityCurve };
  });
  return { status: 'modeled_replay_only' as const, results };
}
