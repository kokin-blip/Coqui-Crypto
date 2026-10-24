import { nativeExecutionRules, knownNativeRule, unknownNativeRule, capitalHash, canonicalJson, type CanonicalJsonValue } from '@coqui/core';

/** Preserve exact string precision. Asset examples and absent maxima aren't current legal bounds. */
export function normalizeAlpacaCapitalRules(raw: unknown, input: { readonly symbol: string; readonly assetId: string;
  readonly observedAtMs: number; readonly evidenceRef: string }) {
  const row = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (row['class'] !== 'crypto' || row['symbol'] !== input.symbol || !input.symbol.endsWith('/USD') || typeof row['id'] !== 'string') throw new Error('native_product_identity_mismatch');
  const field = (key: string) => typeof row[key] === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(row[key]) && /[1-9]/u.test(row[key])
    ? knownNativeRule(row[key]) : unknownNativeRule(`provider_${key}_missing_or_precision_unknown`);
  const sanitized = Object.fromEntries(['id', 'class', 'symbol', 'status', 'tradable', 'min_order_size', 'min_trade_increment', 'max_order_size', 'price_increment']
    .filter(key => ['string', 'number', 'boolean'].includes(typeof row[key])).map(key => [key, row[key]]));
  return nativeExecutionRules({ provider: 'alpaca', environment: 'paper', assetId: input.assetId, productId: row['id'], baseCurrency: input.symbol.split('/')[0]!,
    quoteCurrency: 'USD', form: 'market_quantity', timeInForce: 'gtc', tradable: typeof row['tradable'] === 'boolean' && typeof row['status'] === 'string'
      ? row['tradable'] && row['status'] === 'active' : null, assurance: 'observed',
    quantityIncrement: field('min_trade_increment'), quantityMin: field('min_order_size'), quantityMax: field('max_order_size'),
    quoteIncrement: unknownNativeRule('quote_increment_not_supplied'), quoteMin: unknownNativeRule('quote_minimum_not_supplied'),
    quoteMax: unknownNativeRule('account_applicable_notional_maximum_unverified'), priceIncrement: field('price_increment'),
    observedAtMs: input.observedAtMs, expiresAtMs: input.observedAtMs + 30_000, source: 'alpaca-crypto-asset-v1', evidenceRefs: [input.evidenceRef, capitalHash(sanitized)],
    rawEvidenceJson: canonicalJson(sanitized as CanonicalJsonValue) });
}
