import { Decimal } from 'decimal.js';
import { instrumentKey } from '@coqui/core';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';
import { PARALLEL_COSTS, PARALLEL_INSTRUMENTS } from './parallel-signal.js';
import { dayAfter } from './parallel-paper-activity.js';
import { eventFor, money, quantity, symbolFor } from './parallel-paper-utils.js';
import type { PaperDecisionPreparation } from './runtime-model.js';
const CUTOFF_MS = 15 * 60_000, MIN_TRADE = new Decimal(25), BAND = new Decimal('0.05');
const ASSET_IDS = PARALLEL_INSTRUMENTS.map(instrumentKey);
export function settleParallelLocal(experiment: ParallelPaperExperiment,
  preparation: Extract<PaperDecisionPreparation, { ok: true }>, events: readonly ParallelPaperEvent[],
  append: (kind: string, key: string, detail: Record<string, unknown>) => void): void {
    const dataset = preparation.dataset;
    const decisions = events.filter((event) => event.kind === 'decision');
    let cash = money(experiment.openingCoquiCash);
    const held = new Map<string, Decimal>(ASSET_IDS.map((id) => [id, new Decimal(0)]));
    for (const fill of events.filter((event) => event.kind === 'local_fill')) {
      const id = String(fill.detail['assetId']);
      held.set(id, (held.get(id) ?? new Decimal(0)).plus(String(fill.detail['qty'])));
      cash = cash.plus(String(fill.detail['cashDelta']));
    }
    for (const decision of decisions) {
      const day = String(decision.detail['day']);
      const executionDay = dayAfter(day);
      if (!dataset.dayKeys.includes(executionDay) || eventFor(events, 'local_settled', day) !== undefined) continue;
      if (decision.at - Date.parse(`${executionDay}T00:00:00Z`) > CUTOFF_MS) {
        append('local_settled', `local-settled:${day}`, { day, executionDay, skipped: 'late_decision' });
        continue;
      }
      const index = dataset.dayKeys.indexOf(executionDay);
      const opens = new Map(ASSET_IDS.map((id) => [id, money(String(dataset.opensById[id]?.[index]))]));
      const equity = ASSET_IDS.reduce((sum, id) => sum.plus(held.get(id)!.mul(opens.get(id)!)), cash);
      if (!equity.isPositive()) throw new Error('local_wallet_unavailable');
      const weights = decision.detail['weights'] as Record<string, number>;
      const orders = ASSET_IDS.map((id) => {
        const price = opens.get(id)!;
        const actual = held.get(id)!.mul(price).div(equity);
        const target = money(String(weights[id]));
        const delta = money(quantity(equity.mul(target).div(price).minus(held.get(id)!)));
        return { id, price, delta, drift: target.minus(actual).abs() };
      }).filter((item) => item.drift.greaterThanOrEqualTo(BAND) && item.delta.abs().mul(item.price).greaterThanOrEqualTo(MIN_TRADE))
        .sort((a, b) => a.delta.isNegative() === b.delta.isNegative() ? a.id.localeCompare(b.id) : a.delta.isNegative() ? -1 : 1);
      for (const order of orders) {
        let qty = order.delta;
        const friction = money(PARALLEL_COSTS.spread).plus(PARALLEL_COSTS.slippage);
        if (qty.isPositive()) {
          const cap = money(quantity(cash.div(order.price.mul(new Decimal(1).plus(friction))
            .div(new Decimal(1).plus(PARALLEL_COSTS.fee)))));
          qty = Decimal.min(qty, cap);
        }
        if (qty.isZero() || qty.abs().mul(order.price).lessThan(MIN_TRADE)) continue;
        const fillPrice = order.price.mul(qty.isPositive() ? new Decimal(1).plus(friction) : new Decimal(1).minus(friction));
        const fee = qty.abs().mul(fillPrice).mul(PARALLEL_COSTS.fee);
        const cashDelta = qty.mul(fillPrice).neg().minus(fee);
        cash = cash.plus(cashDelta);
        held.set(order.id, held.get(order.id)!.plus(qty));
        append('local_fill', `local:${day}:${order.id}`,
          { day: executionDay, decisionDay: day, assetId: order.id, symbol: symbolFor(order.id),
            qty: quantity(qty), rawOpen: order.price.toString(), fillPrice: fillPrice.toString(),
            fee: fee.toString(), cashDelta: cashDelta.toString() });
      }
      append('local_settled', `local-settled:${day}`, { day, executionDay });
    }
}
