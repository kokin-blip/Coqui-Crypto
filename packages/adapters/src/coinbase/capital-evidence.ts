import { isDecimalString, sha256Hex } from '@coqui/core';

export interface CoinbaseCapitalTransactionMetadata {
  readonly accountUuid: string; readonly transactionId: string;
  readonly counterpartyAccountHash: string | null;
  readonly counterpartyKind: 'account' | 'external' | 'unknown';
  readonly fee: { readonly asset: string; readonly quantity: string } | null;
  readonly fillEntryId: string | null; readonly orderId: string | null; readonly tradeId: string | null;
}
export interface CoinbaseCapitalEvidenceEnvelope {
  readonly schemaVersion: 1;
  readonly accounts: readonly { readonly accountUuid: string; readonly portfolioIdentityHash: string | null }[];
  readonly transactions: readonly CoinbaseCapitalTransactionMetadata[];
  readonly paginationComplete: boolean;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value) ? value : null;
}
export function coinbaseCapitalPortfolioHash(raw: unknown): string | null {
  const id = record(raw)?.['retail_portfolio_id'];
  return typeof id === 'string' && /^[a-f0-9-]{36}$/iu.test(id) ? sha256Hex(id.toLowerCase()) : null;
}
/** Retain only financial identifiers and fee fields; discard descriptions, addresses and personal data. */
export function coinbaseCapitalTransactionMetadata(raw: unknown, accountUuid: string, transactionId: string): CoinbaseCapitalTransactionMetadata {
  const data = record(raw), peer = record(data?.['to']) ?? record(data?.['from']);
  const peerId = identifier(peer?.['id']);
  const fee = record(data?.['transaction_fee']) ?? record(record(data?.['network'])?.['transaction_fee']);
  const fill = record(data?.['advanced_trade_fill']);
  const quantity = fee?.['amount'], asset = fee?.['currency'];
  return { accountUuid, transactionId,
    counterpartyAccountHash: peer?.['resource'] === 'account' && peerId !== null ? sha256Hex(peerId.toLowerCase()) : null,
    counterpartyKind: peer?.['resource'] === 'account' ? 'account' : peer === null ? 'unknown' : 'external',
    fee: typeof quantity === 'string' && isDecimalString(quantity) && !quantity.startsWith('-') && typeof asset === 'string' && /^[A-Z0-9._-]{1,32}$/u.test(asset)
      ? { asset, quantity } : null,
    fillEntryId: identifier(fill?.['entry_id']), orderId: identifier(fill?.['order_id']), tradeId: identifier(fill?.['trade_id']),
  };
}
