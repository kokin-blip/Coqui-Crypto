import { childRequestDeadline, withinDeadline, type RequestDeadline, type createAlpacaPaperClient } from '@coqui/adapters';
import { Decimal } from 'decimal.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';
import type { ParallelPaperDependencies } from './parallel-paper-service.js';
import type { PaperDecisionPreparation } from './runtime-model.js';

export function parallelAttemptsResolved(events: readonly ParallelPaperEvent[]): boolean {
  return events.filter((event) => event.kind === 'submit_attempt').every((attempt) => {
    const order = [...events].reverse().find((event) => event.kind === 'external_order' &&
      event.detail['clientOrderId'] === attempt.detail['clientOrderId']);
    return order?.detail['status'] === 'filled' && events.filter((event) => event.kind === 'external_fill' &&
      event.detail['orderId'] === order.detail['orderId']).reduce((sum, event) =>
        sum.plus(String(event.detail['quantity'] ?? '0')), new Decimal(0)).gte(String(order.detail['filledQty']));
  });
}

export async function validateParallelBroker(experiment: ParallelPaperExperiment,
  client: ReturnType<typeof createAlpacaPaperClient>, events: readonly ParallelPaperEvent[]): Promise<boolean> {
  const [account, open] = await Promise.all([client.account(), client.orders('open')]);
  if (account.id !== experiment.alpacaAccountId || !['ACTIVE', 'PAPER_ONLY'].includes(account.status) ||
      account.trading_blocked || account.account_blocked) throw new Error('alpaca_account_changed');
  const known = new Set(events.filter((event) => event.kind === 'external_intent').map((event) => event.detail['clientOrderId']));
  if (open.some((order) => !known.has(order.client_order_id))) throw new Error('unexpected_alpaca_order');
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
