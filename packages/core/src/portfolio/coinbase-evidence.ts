import { Decimal } from 'decimal.js';

import { sha256Hex } from '../crypto/sha256.js';
import {
  decimal,
  nonNegativeDecimal,
  type AssetQuantity,
  type DecimalString,
  type TaxLot,
} from '../types/index.js';

export interface CoinbaseAccountEvidence {
  readonly accountUuid: string;
  readonly currency: string;
  readonly availableQuantity: AssetQuantity;
  readonly holdQuantity: AssetQuantity;
  readonly totalQuantity: AssetQuantity;
  readonly active: boolean;
  readonly ready: boolean;
  readonly defaultAccount: boolean;
  /** Coinbase account update time; null only when the provider omitted it. */
  readonly providerUpdatedAtMs: number | null;
}

export interface CoinbaseFillEvidence {
  readonly tradeId: string;
  readonly orderId: string;
  readonly productId: string;
  readonly side: 'BUY' | 'SELL';
  readonly price: DecimalString;
  readonly size: AssetQuantity;
  readonly commission: DecimalString;
  readonly sizeInQuote: boolean;
  readonly tradeAtMs: number;
  readonly sequenceAtMs: number;
}

export interface CoinbaseLocalBalance {
  readonly currency: string;
  readonly quantity: AssetQuantity;
}

/** Aggregate the explicit remaining local ledger by provider currency. */
export function coinbaseLocalBalancesFromLots(
  lots: readonly TaxLot[],
): readonly CoinbaseLocalBalance[] {
  const totals = new Map<string, Decimal>();
  for (const lot of lots) {
    const currency = canonicalCurrency(lot.asset.baseAsset);
    const remaining = quantity(lot.remaining);
    if (remaining.isZero()) continue;
    totals.set(currency, (totals.get(currency) ?? new Decimal(0)).plus(remaining));
  }
  return Object.freeze([...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, total]) => Object.freeze({
      currency,
      quantity: decimal(total.toFixed()),
    })));
}

export type CoinbaseBalanceDiscrepancyKind =
  | 'provider_exceeds_local'
  | 'local_exceeds_provider';

export interface CoinbaseBalanceDiscrepancy {
  readonly currency: string;
  readonly kind: CoinbaseBalanceDiscrepancyKind;
  readonly providerQuantity: AssetQuantity;
  readonly localQuantity: AssetQuantity;
  readonly deltaQuantity: AssetQuantity;
}

function canonicalCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/u.test(currency)) {
    throw new TypeError('Coinbase evidence contains an invalid currency.');
  }
  return currency;
}

function quantity(value: string): Decimal {
  const exact = nonNegativeDecimal(value);
  const parsed = new Decimal(exact);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new TypeError('Coinbase evidence contains an invalid quantity.');
  }
  return parsed;
}

/** Add the provider's available and held balances without binary rounding. */
export function coinbaseAccountTotalQuantity(
  availableQuantity: string,
  holdQuantity: string,
): AssetQuantity {
  return decimal(quantity(availableQuantity).plus(quantity(holdQuantity)).toFixed());
}

function aggregateBalances(
  rows: readonly { readonly currency: string; readonly quantity: string }[],
): Map<string, Decimal> {
  const totals = new Map<string, Decimal>();
  for (const row of rows) {
    const currency = canonicalCurrency(row.currency);
    if (currency === 'USD') continue;
    totals.set(currency, (totals.get(currency) ?? new Decimal(0)).plus(quantity(row.quantity)));
  }
  return totals;
}

/** Compare complete provider balances with the local ledger without inventing a resolution. */
export function reconcileCoinbaseBalances(
  accounts: readonly CoinbaseAccountEvidence[],
  localBalances: readonly CoinbaseLocalBalance[],
): readonly CoinbaseBalanceDiscrepancy[] {
  const provider = aggregateBalances(accounts.map((account) => ({
    currency: account.currency,
    quantity: account.totalQuantity,
  })));
  const local = aggregateBalances(localBalances);
  const currencies = [...new Set([...provider.keys(), ...local.keys()])].sort();
  const discrepancies: CoinbaseBalanceDiscrepancy[] = [];
  for (const currency of currencies) {
    const providerQuantity = provider.get(currency) ?? new Decimal(0);
    const localQuantity = local.get(currency) ?? new Decimal(0);
    const comparison = providerQuantity.cmp(localQuantity);
    if (comparison === 0) continue;
    discrepancies.push(Object.freeze({
      currency,
      kind: comparison > 0 ? 'provider_exceeds_local' : 'local_exceeds_provider',
      providerQuantity: decimal(providerQuantity.toFixed()),
      localQuantity: decimal(localQuantity.toFixed()),
      deltaQuantity: decimal(providerQuantity.minus(localQuantity).abs().toFixed()),
    }));
  }
  return Object.freeze(discrepancies);
}

function canonicalAccounts(accounts: readonly CoinbaseAccountEvidence[]) {
  return [...accounts]
    .map((account) => ({
      accountUuid: account.accountUuid,
      currency: account.currency,
      availableQuantity: account.availableQuantity,
      holdQuantity: account.holdQuantity,
      totalQuantity: account.totalQuantity,
      active: account.active,
      ready: account.ready,
      defaultAccount: account.defaultAccount,
      providerUpdatedAtMs: account.providerUpdatedAtMs,
    }))
    .sort((left, right) => left.accountUuid.localeCompare(right.accountUuid));
}

function canonicalFills(fills: readonly CoinbaseFillEvidence[]) {
  return [...fills]
    .map((fill) => ({
      tradeId: fill.tradeId,
      orderId: fill.orderId,
      productId: fill.productId,
      side: fill.side,
      price: fill.price,
      size: fill.size,
      commission: fill.commission,
      sizeInQuote: fill.sizeInQuote,
      tradeAtMs: fill.tradeAtMs,
      sequenceAtMs: fill.sequenceAtMs,
    }))
    .sort((left, right) =>
      left.sequenceAtMs - right.sequenceAtMs ||
      left.tradeAtMs - right.tradeAtMs ||
      left.tradeId.localeCompare(right.tradeId));
}

/** Hash only normalized provider facts; pagination and local receipt timing remain separate evidence. */
export function coinbaseEvidenceDatasetHash(
  accounts: readonly CoinbaseAccountEvidence[],
  fills: readonly CoinbaseFillEvidence[],
): string {
  return sha256Hex(JSON.stringify({
    schemaVersion: 1,
    accounts: canonicalAccounts(accounts),
    fills: canonicalFills(fills),
  }));
}
