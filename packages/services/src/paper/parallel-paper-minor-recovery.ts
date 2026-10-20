import { Decimal } from 'decimal.js';
import { HOURLY_EXECUTION_V1 } from '@coqui/core';
import type { createAlpacaPaperClient } from '@coqui/adapters';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';
import { validateParallelPositions } from './parallel-paper-recovery.js';
import { ParallelReconciliationError, type PaperPendingFeeDetail, type PaperPositionDifference } from './parallel-paper-utils.js';

const DAY_MS = 86_400_000;
/** A diagnostic hypothesis only: never a booked fee or permission to trade. */
function pendingFeeEvidence(events: readonly ParallelPaperEvent[], differences: readonly PaperPositionDifference[],
  startedAt: number, now: number): PaperPendingFeeDetail | undefined {
  const timestamps: number[] = [];
  try {
    for (const difference of differences) {
      if (!['BTCUSD', 'ETHUSD', 'LTCUSD'].includes(difference.symbol)) return;
      const residual = new Decimal(difference.differenceQty);
      if (!residual.isFinite() || residual.gte(0) || new Decimal(difference.expectedQty).lte(0) ||
          new Decimal(difference.observedQty).lt(0)) return;
      const fills = events.filter(event => event.kind === 'external_fill' &&
        String(event.detail['symbol']).replaceAll('/', '') === difference.symbol);
      const rows = fills.map(fill => ({ fill, time: Date.parse(String(fill.detail['at'])),
        order: events.find(event => event.kind === 'external_order' && event.detail['orderId'] === fill.detail['orderId']) }));
      if (!rows.length || rows.some(row => !Number.isFinite(row.time) || row.time < startedAt || row.time > now || !row.order)) return;
      const lastDay = Math.floor(Math.max(...rows.map(row => row.time)) / DAY_MS);
      const latest = rows.filter(row => Math.floor(row.time / DAY_MS) === lastDay);
      // Mixed buy/sell days and different fee rates remain unexplained, never waived.
      if (latest.some(row => row.order!.detail['side'] !== 'buy')) return;
      let gross = new Decimal(0);
      for (const row of latest) {
        const quantity = new Decimal(String(row.fill.detail['quantity']));
        if (!quantity.isFinite() || quantity.lte(0)) return;
        gross = gross.plus(quantity); timestamps.push(row.time);
      }
      const candidate = gross.mul(String(HOURLY_EXECUTION_V1.takerFeeRate));
      if (residual.abs().minus(candidate).abs().gt(new Decimal('0.000000003').mul(latest.length))) return;
    }
  } catch { return; }
  if (!timestamps.length) return;
  const oldestFillAtMs = Math.min(...timestamps), latestFillAtMs = Math.max(...timestamps);
  // Review after one full UTC day beyond the oldest trade day. This is an alert
  // threshold, not a provider SLA, expiry, or permission to bypass reconciliation.
  const reviewAfterMs = (Math.floor(oldestFillAtMs / DAY_MS) + 2) * DAY_MS;
  return { status: now >= reviewAfterMs ? 'overdue' : 'awaiting', oldestFillAtMs, latestFillAtMs, reviewAfterMs };
}

/** Exact fee evidence is required at every value; historical allowances cannot clear a check. */
export async function reconcilePaperPositionEvidence(input: {
  experiment: ParallelPaperExperiment; client: ReturnType<typeof createAlpacaPaperClient>;
  events(): readonly ParallelPaperEvent[]; now(): number; fullAudit(): Promise<void>;
  append(kind: string, key: string, detail: Record<string, unknown>): void;
}): Promise<void> {
  const observe = (positions: readonly { symbol: string; quantity: string }[]) => input.append('broker_position_snapshot',
    `positions:${input.events().length}`, { accountId: input.experiment.alpacaAccountId, positions, observedAtMs: input.now() });
  try { await validateParallelPositions(input.client, input.events(), observe); return; }
  catch (error) {
    if (!(error instanceof ParallelReconciliationError) || error.positionDifferences.length === 0) throw error;
  }
  await input.fullAudit();
  try { await validateParallelPositions(input.client, input.events(), observe); }
  catch (error) {
    if (!(error instanceof ParallelReconciliationError) || error.positionDifferences.length === 0) throw error;
    const pending = pendingFeeEvidence(input.events(), error.positionDifferences, input.experiment.startedAt, input.now());
    throw new ParallelReconciliationError('broker_positions_mismatch', 'positions', undefined,
      error.positionDifferences, undefined, pending);
  }
}
