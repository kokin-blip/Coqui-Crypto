/** Research venues may supply bars; only Coinbase has application integrations. */
export type Venue = 'coinbase' | 'binance' | 'kraken';
export type ProductType = 'spot';

declare const instrumentKeyBrand: unique symbol;

/** Collision-resistant key derived only from canonical venue identifiers. */
export type InstrumentKey = string & { readonly [instrumentKeyBrand]: true };

/** Canonical identity used for joins, persistence, and market-data alignment. */
export interface InstrumentIdentity {
  readonly venue: Venue;
  readonly productId: string;
  readonly productType: ProductType;
}

/** Build a stable key without consulting a display symbol. */
export function instrumentKey(identity: InstrumentIdentity): InstrumentKey {
  if (identity.productId.length === 0 || identity.productId.includes('|')) {
    throw new TypeError('A canonical product id must be non-empty and cannot contain a pipe');
  }
  return `${identity.venue}|${identity.productType}|${identity.productId}` as InstrumentKey;
}

/** Compare canonical venue identity rather than presentation fields. */
export function sameInstrument(left: InstrumentIdentity, right: InstrumentIdentity): boolean {
  return instrumentKey(left) === instrumentKey(right);
}
