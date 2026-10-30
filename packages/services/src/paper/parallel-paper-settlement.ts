import { Decimal } from 'decimal.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';
import { parallelAttemptsResolved, parallelPositionLedger } from './parallel-paper-recovery.js';
import type { PaperPositionDifference } from './parallel-paper-utils.js';

const symbolOf = (value: unknown) => String(value).replaceAll('/', '');
const SYMBOLS = ['BTCUSD', 'ETHUSD', 'LTCUSD'];
const decimal = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('invalid_settlement');
  const result = new Decimal(value);
  if (!result.isFinite() || result.lt(0)) throw new Error('invalid_settlement');
  return result;
};
function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_settlement');
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/u.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) throw new Error('invalid_settlement');
  return `${match[1]}.${(match[2] ?? '').padEnd(9, '0')}Z`;
}

/** Independent net-position proof, never a fee estimate or a replacement accounting entry.
 * Call only after a full broker activity audit and ordinary account/order/fill gates.
 * Every fill since a clean ledger baseline must have its exact broker execution ID,
 * cumulative order quantity, price, side and net-position update. A percentage alone
 * cannot satisfy this proof. The bound only rejects implausible observed buy debits.
 */
export function verifyPaperSettlement(input: {
  experiment: ParallelPaperExperiment; events: readonly ParallelPaperEvent[];
  differences: readonly PaperPositionDifference[]; nowMs: number;
}) {
  try {
    const { events, experiment } = input;
    if (!parallelAttemptsResolved(events)) return null;
    const clean = events.findLastIndex(event => event.kind === 'readiness' &&
      event.detail['operation'] === 'broker_reconciliation' && event.detail['status'] === 'validated' &&
      event.detail['positionBasis'] !== 'broker_trade_updates');
    const anchorIndex = events.findLastIndex((event, index) => index < clean && event.kind === 'broker_position_snapshot');
    const anchor = events[anchorIndex];
    if (!anchor || anchor.detail['accountId'] !== experiment.alpacaAccountId ||
        anchor.at < experiment.startedAt || anchor.at > input.nowMs || !Array.isArray(anchor.detail['positions'])) return null;
    const before = events.slice(0, anchorIndex);
    if (!parallelAttemptsResolved(before) || events.slice(anchorIndex + 1, clean).some(event =>
      ['external_fill', 'external_fee', 'submit_attempt'].includes(event.kind))) return null;
    const ledger = parallelPositionLedger(before), quantities = new Map<string, Decimal>();
    for (const row of anchor.detail['positions'] as { symbol: string; quantity: string }[]) {
      const symbol = symbolOf(row.symbol), quantity = decimal(row.quantity);
      if (!SYMBOLS.includes(symbol) || quantities.has(symbol) || !quantity.eq(ledger.get(symbol) ?? 0)) return null;
      quantities.set(symbol, quantity); ledger.delete(symbol);
    }
    if ([...ledger.values()].some(value => !value.isZero())) return null;
    const after = events.slice(anchorIndex + 1), fills = after.filter(event => event.kind === 'external_fill');
    if (!fills.length) return null;
    const updates = after.filter(event => event.kind === 'broker_trade_update');
    const used = new Set<string>(), cumulative = new Map<unknown, Decimal>(), debits = new Map<string, Decimal>();
    const paired = fills.map(fill => {
      const id = String(fill.detail['activityId']);
      const candidates = updates.filter(update => id === update.detail['executionId'] ||
        typeof update.detail['executionId'] === 'string' && id.endsWith(`::${update.detail['executionId']}`));
      if (candidates.length !== 1) throw new Error('invalid_settlement');
      return { fill, update: candidates[0]!, time: timestamp(candidates[0]!.detail['at']) };
    }).sort((a, b) => a.time.localeCompare(b.time));
    const lastTimes = new Map<string, string>();
    let oldestFillAtMs = input.nowMs;
    for (const { fill, update, time } of paired) {
      const d = update.detail, symbol = symbolOf(d['symbol']), qty = decimal(d['quantity']);
      const atMs = Date.parse(time), fillAtMs = Date.parse(String(fill.detail['at'])), executionId = String(d['executionId']);
      const order = events.findLast(event => event.kind === 'external_order' && event.detail['orderId'] === d['orderId']);
      const intent = events.find(event => event.kind === 'external_intent' && event.detail['clientOrderId'] === d['clientOrderId']);
      if (!SYMBOLS.includes(symbol) || time === lastTimes.get(symbol) || atMs < anchor.at || atMs > input.nowMs || used.has(executionId) ||
          update.at < anchor.at || update.at > input.nowMs || d['source'] !== 'alpaca_paper_trade_updates' ||
          d['accountId'] !== experiment.alpacaAccountId || !order || !intent || order.detail['status'] !== 'filled' ||
          order.detail['clientOrderId'] !== d['clientOrderId'] || symbolOf(order.detail['symbol']) !== symbol ||
          symbolOf(intent.detail['symbol']) !== symbol || intent.detail['side'] !== d['side'] || order.detail['side'] !== d['side'] ||
          !events.some(event => event.kind === 'submit_attempt' && event.detail['clientOrderId'] === d['clientOrderId']) ||
          fill.detail['orderId'] !== d['orderId'] || symbolOf(fill.detail['symbol']) !== symbol ||
          !Number.isFinite(fillAtMs) || Math.abs(fillAtMs - atMs) > 1 ||
          !qty.gt(0) || !qty.eq(decimal(fill.detail['quantity'])) || !decimal(d['price']).gt(0) ||
          !decimal(d['price']).eq(decimal(fill.detail['price']))) return null;
      lastTimes.set(symbol, time); used.add(executionId); oldestFillAtMs = Math.min(oldestFillAtMs, atMs);
      const filled = (cumulative.get(d['orderId']) ?? new Decimal(0)).plus(qty);
      if (!filled.eq(decimal(d['filledQty'])) || filled.gt(decimal(order.detail['filledQty']))) return null;
      cumulative.set(d['orderId'], filled);
      const prior = quantities.get(symbol) ?? new Decimal(0), net = decimal(d['positionQty']);
      const debit = prior.plus(d['side'] === 'buy' ? qty : qty.neg()).minus(net);
      if (d['side'] === 'sell' ? !debit.isZero() : d['side'] !== 'buy' || debit.lt(0) ||
          debit.gt(qty.mul('0.0025').toDecimalPlaces(9, Decimal.ROUND_UP))) return null;
      debits.set(symbol, (debits.get(symbol) ?? new Decimal(0)).plus(debit));
      quantities.set(symbol, net);
    }
    for (const [id, qty] of cumulative) {
      const order = events.findLast(event => event.kind === 'external_order' && event.detail['orderId'] === id)!;
      if (!qty.eq(decimal(order.detail['filledQty']))) return null;
    }
    for (const fee of after.filter(event => event.kind === 'external_fee')) {
      const symbol = symbolOf(fee.detail['symbol']);
      if (['null', 'USD', ''].includes(symbol)) continue;
      const qty = new Decimal(String(fee.detail['quantity']));
      if (!SYMBOLS.includes(symbol) || !qty.isFinite() || qty.gte(0) || fee.detail['status'] !== 'executed') return null;
      debits.set(symbol, (debits.get(symbol) ?? new Decimal(0)).minus(qty.abs()));
    }
    const currentLedger = parallelPositionLedger(events);
    const differences = new Map(input.differences.map(row => [row.symbol, row]));
    const pending = [];
    for (const symbol of new Set([...quantities.keys(), ...currentLedger.keys(), ...differences.keys()])) {
      const debit = debits.get(symbol) ?? new Decimal(0), row = differences.get(symbol);
      const net = quantities.get(symbol) ?? new Decimal(0), recorded = currentLedger.get(symbol) ?? new Decimal(0);
      if (debit.lt(0) || !recorded.minus(net).eq(debit) ||
          (row ? !net.eq(decimal(row.observedQty)) || !debit.neg().eq(row.differenceQty) : !debit.isZero())) return null;
      if (debit.gt(0)) pending.push({ symbol, quantity: net.toString(), unreportedDebitQty: debit.toString() });
    }
    if (!pending.length) return null;
    return { basis: 'broker_trade_updates' as const, anchorId: anchor.id, oldestFillAtMs,
      executionIds: [...used], pending };
  } catch { return null; }
}
