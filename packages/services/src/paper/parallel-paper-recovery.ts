import { childRequestDeadline, withinDeadline, type RequestDeadline, type createAlpacaPaperClient } from '@coqui/adapters';
import { Decimal } from 'decimal.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';
import type { ParallelPaperDependencies } from './parallel-paper-service.js';
import { ParallelReconciliationError, type PaperPositionDifference } from './parallel-paper-utils.js';
import type { PaperDecisionPreparation } from './runtime-model.js';

export function parallelAttemptsResolved(events: readonly ParallelPaperEvent[]): boolean {
  return events.filter((event) => event.kind === 'submit_attempt').every((attempt) => {
    const order = [...events].reverse().find((event) => event.kind === 'external_order' &&
      event.detail['clientOrderId'] === attempt.detail['clientOrderId']);
    return order?.detail['status'] === 'filled' && events.filter((event) => event.kind === 'external_fill' &&
      event.detail['orderId'] === order.detail['orderId']).reduce((sum, event) =>
        sum.plus(String(event.detail['quantity'] ?? '0')), new Decimal(0)).eq(String(order.detail['filledQty']));
  });
}

export async function validateParallelBroker(experiment: ParallelPaperExperiment,
  client: ReturnType<typeof createAlpacaPaperClient>, events: readonly ParallelPaperEvent[]): Promise<boolean> {
  const [account, open] = await Promise.all([client.account(), client.orders('open')]);
  if (account.id !== experiment.alpacaAccountId || account.currency !== 'USD' || !['ACTIVE', 'PAPER_ONLY'].includes(account.status) ||
      account.trading_blocked !== false || account.account_blocked !== false) throw new ParallelReconciliationError('alpaca_account_changed', 'account');
  const known = new Set(events.filter((event) => event.kind === 'external_intent').map((event) => event.detail['clientOrderId']));
  if (open.some((order) => !known.has(order.client_order_id))) throw new ParallelReconciliationError('unexpected_alpaca_order', 'orders');
  return open.length === 0;
}

export async function prepareParallelPass(input: Pick<ParallelPaperDependencies, 'clock' | 'refreshFor' | 'preparation'>,
  deadline?: RequestDeadline): Promise<PaperDecisionPreparation> {
  if (!deadline) return input.preparation();
  const budget = Math.min(10_000, deadline.remainingMs() - 15_000);
  if (budget <= 0) throw new Error('deadline_exceeded');
  const preparationDeadline = childRequestDeadline(deadline, budget);
  try { return await withinDeadline(input.refreshFor(input.clock.nowMs(), preparationDeadline), preparationDeadline); }
  finally { preparationDeadline.dispose(); }
}

/** A clean opening account has zero quantities; unexplained residuals never auto-resume. */
export async function validateParallelPositions(client: ReturnType<typeof createAlpacaPaperClient>,
  events: readonly ParallelPaperEvent[]): Promise<void> {
  const expected = new Map<string, Decimal>();
  const symbolKey = (value: unknown) => String(value).replaceAll('/', '');
  const add = (symbol: string, qty: Decimal) => expected.set(symbol, (expected.get(symbol) ?? new Decimal(0)).plus(qty));
  try {
    for (const fill of events.filter((event) => event.kind === 'external_fill')) {
      const order = events.find((event) => event.kind === 'external_order' && event.detail['orderId'] === fill.detail['orderId']);
      const qty = new Decimal(String(fill.detail['quantity']));
      if (!order || symbolKey(fill.detail['symbol']) !== symbolKey(order.detail['symbol']) || !['buy', 'sell'].includes(String(order.detail['side'])) || !qty.isFinite() || qty.lt(0))
        throw new Error('invalid_fill');
      add(symbolKey(fill.detail['symbol']), order.detail['side'] === 'buy' ? qty : qty.neg());
    }
    for (const fee of events.filter((event) => event.kind === 'external_fee')) {
      const symbol = symbolKey(fee.detail['symbol']);
      if (symbol === 'null' || symbol === 'USD' || symbol === '') continue;
      const qty = new Decimal(String(fee.detail['quantity']));
      if (!qty.isFinite()) throw new Error('invalid_fee');
      add(symbol, qty.abs().neg());
    }
  } catch { throw new ParallelReconciliationError('broker_positions_mismatch', 'positions'); }
  const positions = await client.positions();
  const differences: PaperPositionDifference[] = [];
  const compare = (symbol: string, observed: Decimal, recorded: Decimal) => {
    if (!observed.eq(recorded)) differences.push({ symbol, expectedQty: recorded.toString(),
      observedQty: observed.toString(), differenceQty: observed.minus(recorded).toString() });
  };
  try {
    const seen = new Set<string>();
    for (const position of positions) {
      const symbol = symbolKey(position.symbol), qty = new Decimal(position.qty);
      if (!symbol || symbol.length > 128 || seen.has(symbol) || !qty.isFinite() || qty.lt(0)) throw new Error('invalid_position');
      seen.add(symbol);
      compare(symbol, qty, expected.get(symbol) ?? new Decimal(0));
      expected.delete(symbol);
    }
    for (const [symbol, qty] of expected) compare(symbol, new Decimal(0), qty);
  } catch { throw new ParallelReconciliationError('broker_positions_mismatch', 'positions'); }
  if (differences.length > 0) throw new ParallelReconciliationError('broker_positions_mismatch', 'positions', undefined, differences.slice(0, 100));
}
