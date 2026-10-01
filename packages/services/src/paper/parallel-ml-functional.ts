import { instrumentKey, proposeMlTarget } from '@coqui/core';
import type { ParallelPaperEvent } from '@coqui/storage';

import { executeParallelIntraday } from './parallel-paper-intraday.js';
import { PARALLEL_INSTRUMENTS } from './parallel-signal.js';

/** Run the ML-to-existing-order path entirely in memory; no credentials or network. */
export async function verifyParallelMlExecutionPath(): Promise<boolean> {
  try {
    const baseline = [0.2, 0.2, 0.2];
    const noTrade = proposeMlTarget(baseline, [0, 0, 0]);
    const changed = proposeMlTarget(baseline, [0.2, -0.2, 0.01]);
    if (noTrade.turnover !== 0 || changed.turnover <= 0 || changed.weights.some((weight, index) =>
      weight < 0 || Math.abs(weight - baseline[index]!) > 0.100000001)) return false;
    const first = Date.parse('2026-09-24T08:02:00Z');
    const run = async (partial: boolean) => {
      const events: ParallelPaperEvent[] = [];
      let submits = 0;
      const orders = new Map<string, Record<string, string>>();
      const append = (kind: string, key: string, detail: Record<string, unknown>) => {
        events.push({ id: key, experimentId: 'functional-check', profileId: 'functional-check',
          kind, at: first, detail });
      };
      const client = {
        orders: async () => [], account: async () => ({ id: 'functional-account', status: 'PAPER_ONLY', currency: 'USD', trading_blocked: false, account_blocked: false, equity: '100000', cash: '100000' }),
        positions: async () => [],
        asset: async (symbol: string) => ({ symbol, status: 'active', tradable: true,
          min_trade_increment: '0.0001', min_order_size: '0.0001' }),
        latestCryptoQuotes: async () => ({ quotes: Object.fromEntries(['BTC', 'ETH', 'LTC'].map((symbol) =>
          [`${symbol}/USD`, { bp: '100', ap: '101', t: new Date(first).toISOString() }])) }),
        submit: async (order: { client_order_id: string; symbol: string; side: string; qty: string }) => {
          submits += 1;
          const result = { id: `paper-${submits}`, client_order_id: order.client_order_id,
            symbol: order.symbol, side: order.side, status: partial ? 'partially_filled' : 'filled',
            qty: order.qty, filled_qty: partial ? '0.0001' : order.qty, filled_avg_price: '100' };
          orders.set(order.client_order_id, result);
          return result;
        },
        orderByClientId: async (id: string) => orders.get(id),
      };
      const decision = { id: 'decision', experimentId: 'functional-check', profileId: 'functional-check',
        kind: 'decision', at: first, detail: { day: '2026-09-23', weights: Object.fromEntries(
          PARALLEL_INSTRUMENTS.map((instrument, index) => [instrumentKey(instrument), baseline[index]!])) } };
      const signal = { version: 'trendvol-ml-ridge-v1' as const,
        datasetHash: 'a'.repeat(64), modelHash: 'b'.repeat(64), gate: 'qualified' as const,
        reason: 'qualified', predictedAtMs: Date.parse('2026-09-24T08:00:00Z'),
        prediction: [0.2, -0.2, 0.01], proposedWeights: null, baselineWeights: null,
        expectedNetImprovement: null, evidence: null };
      const invoke = (nowMs: number) => executeParallelIntraday({ nowMs, experimentId: 'functional-check',
        decision, events: () => events, append, client: client as never, mlSignal: signal });
      await invoke(first);
      const firstCount = submits;
      await invoke(first);
      if (firstCount === 0 || submits !== firstCount ||
          events.filter((event) => event.kind === 'ml_target').length !== 1) return false;
      if (partial) {
        if (events.some((event) => event.kind === 'intraday_complete')) return false;
        await invoke(Date.parse('2026-09-24T12:02:00Z'));
        return submits === firstCount;
      }
      return events.some((event) => event.kind === 'intraday_complete');
    };
    return await run(false) && await run(true);
  } catch { return false; }
}
