import { Decimal } from 'decimal.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';

function observedDecimal(value: unknown): Decimal | null {
  if (typeof value !== 'string') return null;
  try { const parsed = new Decimal(value); return parsed.isFinite() ? parsed : null; } catch { return null; }
}

/** Account-level observed fees are separate from modeled trading friction. */
export function parallelFeeAccounting(events: readonly ParallelPaperEvent[], experiment: ParallelPaperExperiment | null) {
  let cashFees = new Decimal(0), reportedUsd = new Decimal(0), unvalued = 0;
  const crypto: Record<string, Decimal> = {}, valuations: {activityId: string; at: string | null; createdAt: string | null; billingDate: string | null; usd: string | null; attribution: string}[] = [];
  const unique = new Set<string>();
  for (const event of events.filter((item) => item.kind === 'external_fee')) {
    const detail = event.detail, activityId = String(detail['activityId']);
    if (unique.has(activityId)) continue;
    unique.add(activityId);
    const symbol = typeof detail['symbol'] === 'string' ? detail['symbol'].replaceAll('/', '').replace(/USD$/u,'') : '';
    const qty = observedDecimal(detail['quantity']);
    const net = observedDecimal(detail['netAmount']);
    const price = observedDecimal(detail['price']);
    let usd: Decimal | null = null;
    if (symbol && symbol !== 'USD' && qty?.isFinite()) {
      crypto[symbol] = (crypto[symbol] ?? new Decimal(0)).plus(qty.abs());
      if (price?.isFinite() && price.gt(0)) usd = qty.abs().mul(price);
    } else if (net?.isFinite()) { usd = net.neg(); cashFees = cashFees.plus(usd); }
    if (usd === null) unvalued++; else reportedUsd = reportedUsd.plus(usd);
    const metadata = events.findLast((item) => item.kind === 'broker_activity_metadata' && item.detail['activityId'] === activityId)?.detail;
    valuations.push({ activityId, at: typeof detail['at'] === 'string' ? detail['at'] : null,
      createdAt: typeof metadata?.['createdAt'] === 'string' ? metadata['createdAt'] : null,
      billingDate: typeof detail['date'] === 'string' ? detail['date'] : null, usd: usd?.toString() ?? null,
      attribution: detail['orderId'] ? 'reported_order_link' : 'account_level' });
  }
  const quantities: Record<string, Decimal> = {};
  let cash = new Decimal(experiment?.openingAlpacaCash ?? '0'), fillsUnknown = false;
  for (const fill of events.filter((item) => item.kind === 'external_fill')) {
    const order = events.find((item) => item.kind === 'external_order' && item.detail['orderId'] === fill.detail['orderId']);
    const symbol = typeof fill.detail['symbol'] === 'string' ? fill.detail['symbol'].replaceAll('/', '').replace(/USD$/u,'') : '';
    if (!order || !symbol || typeof fill.detail['quantity'] !== 'string' || typeof fill.detail['price'] !== 'string') {
      fillsUnknown = true; continue;
    }
    const qty = observedDecimal(fill.detail['quantity']), price = observedDecimal(fill.detail['price']);
    const side = order.detail['side'];
    if (!qty || !price || !qty.isFinite() || qty.lt(0) || !price.isFinite() || price.lte(0) || !['buy','sell'].includes(String(side))) {
      fillsUnknown = true; continue;
    }
    quantities[symbol] = (quantities[symbol] ?? new Decimal(0)).plus(side === 'buy' ? qty : qty.neg());
    cash = cash.plus(qty.mul(price).mul(side === 'buy' ? -1 : 1));
  }
  for (const [symbol, qty] of Object.entries(crypto)) quantities[symbol] = (quantities[symbol] ?? new Decimal(0)).minus(qty);
  cash = cash.minus(cashFees);
  const mark = [...events].reverse().find((event) => event.kind === 'account_mark');
  const positions = mark?.detail['positions'];
  const residuals: Record<string, string | null> = {};
  if (Array.isArray(positions)) for (const position of positions as Record<string, unknown>[]) {
    const symbol = String(position['symbol']).replaceAll('/', '').replace(/USD$/u,'');
    const actual = position['alpacaQty'];
    residuals[symbol] = typeof actual === 'string' && !fillsUnknown ? new Decimal(actual).minus(quantities[symbol] ?? 0).toString() : null;
  }
  const markedCash = mark?.detail['alpacaCashUsd'];
  return { knownCashFeesUsd: cashFees.toString(), cryptoFeeQuantities: Object.fromEntries(Object.entries(crypto).map(([symbol, qty]) => [symbol, qty.toString()])),
    reportedPriceEquivalentUsd: reportedUsd.toString(), valuations, unvaluedActivities: unvalued,
    coverage: 'partial_account_activity' as const, observedActivityCount: unique.size,
    reconstructedCashUsd: experiment && !fillsUnknown ? cash.toString() : null,
    cashResidualUsd: typeof markedCash === 'string' && experiment && !fillsUnknown ? new Decimal(markedCash).minus(cash).toString() : null,
    quantityResiduals: residuals, modeledCostsDeductedFromBrokerEquity: false as const };
}
