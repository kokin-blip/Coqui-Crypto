const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const NON_NEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

declare const decimalBrand: unique symbol;

/** A base-10 value encoded without exponent notation or binary rounding. */
export type DecimalString = string & { readonly [decimalBrand]: true };

/** USD encoded as a validated base-10 string. */
export type UsdAmount = DecimalString;

/** Asset units encoded as a validated base-10 string. */
export type AssetQuantity = DecimalString;

/** Return a validated canonical decimal string. */
export function decimal(value: string): DecimalString {
  if (!DECIMAL_PATTERN.test(value) || value === '-0') {
    throw new TypeError(`Invalid decimal string: ${value}`);
  }
  return value as DecimalString;
}

/** Return a validated non-negative decimal string for balances and ledger amounts. */
export function nonNegativeDecimal(value: string): DecimalString {
  if (!NON_NEGATIVE_DECIMAL_PATTERN.test(value)) {
    throw new TypeError(`Expected a non-negative decimal string: ${value}`);
  }
  return value as DecimalString;
}

/** Narrow an unknown wire value without coercion. */
export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === 'string' && DECIMAL_PATTERN.test(value) && value !== '-0';
}

