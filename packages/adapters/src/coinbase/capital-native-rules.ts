import { nativeExecutionRules, knownNativeRule, unknownNativeRule, canonicalJson, capitalHash, type NativeRuleValue } from '@coqui/core';

const FIELDS = ['product_id', 'product_type', 'base_currency_id', 'quote_currency_id', 'base_increment', 'base_min_size', 'base_max_size',
  'quote_increment', 'quote_min_size', 'quote_max_size', 'price_increment', 'status', 'trading_disabled', 'cancel_only', 'limit_only', 'post_only', 'view_only', 'is_disabled'] as const;
/** Whitelist market facts only. Neither arbitrary provider text nor credentials enter the envelope. */
export function sanitizedCapitalProduct(value: unknown): Readonly<Record<string, string | boolean>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  return Object.fromEntries(FIELDS.filter(key => typeof row[key] === 'string' || typeof row[key] === 'boolean').map(key => [key, row[key] as string | boolean]));
}
export function normalizeCoinbaseCapitalRules(raw: unknown, input: {
  readonly productId: string; readonly assetId: string; readonly observedAtMs: number; readonly evidenceRef: string;
  readonly tradabilityChecked: boolean;
}) {
  const row = sanitizedCapitalProduct(raw);
  if (row['product_id'] !== input.productId || row['product_type'] !== 'SPOT' || row['quote_currency_id'] !== 'USD' ||
    typeof row['base_currency_id'] !== 'string' || input.productId !== `${row['base_currency_id']}-USD`) throw new Error('native_product_identity_mismatch');
  const field = (key: string): NativeRuleValue => typeof row[key] === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(row[key]) && /[1-9]/u.test(row[key])
    ? knownNativeRule(row[key]) : unknownNativeRule(`provider_${key}_missing_or_invalid`);
  const flags = ['trading_disabled', 'cancel_only', 'limit_only', 'post_only', 'view_only', 'is_disabled'];
  const blocked = flags.some(key => row[key] === true);
  const tradable = blocked ? false : input.tradabilityChecked && row['status'] === 'online' && flags.every(key => row[key] === false) ? true : null;
  return nativeExecutionRules({ provider: 'coinbase', environment: 'production_read_only', assetId: input.assetId, productId: input.productId,
    baseCurrency: row['base_currency_id'], quoteCurrency: 'USD', form: 'market_quantity', timeInForce: 'gtc', tradable, assurance: 'observed',
    quantityIncrement: field('base_increment'), quantityMin: field('base_min_size'), quantityMax: field('base_max_size'),
    quoteIncrement: field('quote_increment'), quoteMin: field('quote_min_size'), quoteMax: field('quote_max_size'), priceIncrement: field('price_increment'),
    observedAtMs: input.observedAtMs, expiresAtMs: input.observedAtMs + 30_000,
    source: 'coinbase-advanced-trade-product-v1', evidenceRefs: [input.evidenceRef, capitalHash(row)], rawEvidenceJson: canonicalJson(row) });
}
