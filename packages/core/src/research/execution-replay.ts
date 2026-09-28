/** Offline execution research only. No broker, clock, or strategy-selection authority. */
export interface ExecutionObservation {
  readonly slot: string;
  readonly decisionDay: string;
  readonly targets: readonly number[];
  readonly quotes: readonly { bid: number; ask: number }[];
}
export const EXECUTION_CANDIDATES = [
  { id: 'daily-plus-four-hour', intradayBand: 0.01, dailyOnly: false, costGate: false },
  { id: 'daily-only', intradayBand: 0.01, dailyOnly: true, costGate: false },
  { id: 'intraday-band-3pct', intradayBand: 0.03, dailyOnly: false, costGate: false },
  { id: 'intraday-band-5pct', intradayBand: 0.05, dailyOnly: false, costGate: false },
  { id: 'entry-cost-screen-0.5pct', intradayBand: 0.01, dailyOnly: false, costGate: true },
  { id: 'passive-equal-weight', intradayBand: 1, dailyOnly: false, costGate: false },
  { id: 'passive-btc', intradayBand: 1, dailyOnly: false, costGate: false },
  { id: 'cash', intradayBand: 1, dailyOnly: false, costGate: false },
] as const;

/** Only complete, aligned four-hour tapes qualify. Missing quotes are never interpolated. */
export function replayExecutionPolicies(tape: readonly ExecutionObservation[], openingCash = 100_000, costMultiplier = 1) {
  if (!Number.isFinite(openingCash) || openingCash <= 0 || !Number.isFinite(costMultiplier) || costMultiplier <= 0) throw new Error('invalid_replay_configuration');
  if (tape.length < 6 || tape.length % 6 !== 0) return { status: 'insufficient_matched_quotes' as const, results: [] };
  let previous = -Infinity;
  for (const [index, row] of tape.entries()) {
    const at = Date.parse(`${row.slot}:00:00Z`);
    if (!Number.isFinite(at) || (index === 0 && new Date(at).getUTCHours() !== 0) ||
        (index > 0 && at - previous !== 4 * 3_600_000) ||
        row.decisionDay !== new Date(at - 86_400_000).toISOString().slice(0, 10) ||
        row.targets.length !== 3 || row.targets.some((w) => !Number.isFinite(w) || w < 0) ||
        row.targets.reduce((a, b) => a + b, 0) > 1.00000001 ||
        row.quotes.length !== 3 || row.quotes.some((q) => !Number.isFinite(q.ask) || !Number.isFinite(q.bid) || q.bid <= 0 || q.ask < q.bid)) {
      return { status: 'invalid_or_gapped_tape' as const, results: [] };
    }
    if (index % 6 !== 0 && row.targets.some((w, i) => Math.abs(w - tape[index - 1]!.targets[i]!) > 1e-12)) {
      return { status: 'changed_intraday_target' as const, results: [] };
    }
    previous = at;
  }
  const results = EXECUTION_CANDIDATES.map((policy) => {
    let cash = openingCash, peak = openingCash, drawdown = 0, fees = 0, spread = 0, slippage = 0;
    let turnover = 0, orders = 0, skippedOrders = 0, missedFavorableMoves = 0;
    const held = [0, 0, 0];
    const curve: number[] = [];
    for (const [index, row] of tape.entries()) {
      const mids = row.quotes.map((q) => (q.bid + q.ask) / 2);
      const equity = cash + held.reduce((sum, qty, i) => sum + qty * mids[i]!, 0);
      const passive = policy.id.startsWith('passive-');
      const targets = policy.id === 'passive-btc' ? [1, 0, 0] : policy.id === 'passive-equal-weight'
        ? [1 / 3, 1 / 3, 1 / 3] : policy.id === 'cash' ? [0, 0, 0] : row.targets;
      const scheduled = policy.id !== 'cash' && (!passive || index === 0) && (!policy.dailyOnly || index % 6 === 0);
      const band = index % 6 === 0 ? 0.05 : policy.intradayBand;
      const deltas = targets.map((weight, i) => ({ i, delta: equity * weight / mids[i]! - held[i]! }))
        .sort((a, b) => a.delta - b.delta);
      for (const { i, delta } of deltas) {
        if (Math.abs(delta * mids[i]!) / equity < band || Math.abs(delta * mids[i]!) < 25) continue;
        const buy = delta > 0;
        const feeRate = 0.0025 * costMultiplier;
        const halfSpread = (row.quotes[i]!.ask - row.quotes[i]!.bid) / 2 * costMultiplier;
        const slip = mids[i]! * 0.0015 * costMultiplier;
        const price = mids[i]! + (buy ? 1 : -1) * (halfSpread + slip);
        if (price <= 0) throw new Error('invalid_stressed_fill_price');
        const gate = policy.costGate && buy && feeRate + halfSpread / mids[i]! > 0.005;
        if (!scheduled || gate) {
          if (!passive && policy.id !== 'cash') {
            skippedOrders += 1;
            const next = tape[index + 1]?.quotes[i];
            if (next) {
              const nextMid = (next.bid + next.ask) / 2;
              const opportunity = Math.abs(delta) * (buy ? nextMid * (1 - feeRate) - price : price * (1 - feeRate) - nextMid);
              missedFavorableMoves += Math.max(0, opportunity);
            }
          }
          continue;
        }
        // Buy fees reduce received crypto; sell fees reduce received USD, matching the documented convention.
        const qty = Math.min(Math.abs(delta), buy ? cash / price : held[i]!);
        if (qty * mids[i]! < 25) continue;
        cash += buy ? -qty * price : qty * price * (1 - feeRate);
        held[i] = held[i]! + (buy ? qty * (1 - feeRate) : -qty);
        fees += qty * price * feeRate;
        spread += qty * halfSpread;
        slippage += qty * slip;
        turnover += qty * price;
        orders += 1;
      }
      const marked = cash + held.reduce((sum, qty, i) => sum + qty * mids[i]!, 0);
      peak = Math.max(peak, marked); drawdown = Math.min(drawdown, marked / peak - 1);
      curve.push(marked);
    }
    return { policy: policy.id, orders, feesUsd: fees, spreadUsd: spread, slippageUsd: slippage,
      turnoverUsd: turnover, skippedOrders, missedFavorableMovesUsd: missedFavorableMoves,
      missedFills: null, // No order-book/queue tape: market liquidity and limit fills are unmeasured.
      maxDrawdown: drawdown, netReturn: curve.at(-1)! / openingCash - 1, equityCurve: curve };
  });
  return { status: 'modeled_replay_only' as const, results };
}
