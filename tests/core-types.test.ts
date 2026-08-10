import { describe, expect, it } from 'vitest';
import {
  decimal,
  instrumentKey,
  isDecimalString,
  nonNegativeDecimal,
  sameInstrument,
  type InstrumentIdentity,
} from '../packages/core/src/index.js';

const bitcoin: InstrumentIdentity = {
  venue: 'coinbase',
  productId: 'BTC-USD',
  productType: 'spot',
};

describe('decimal ledger values', () => {
  it('accepts exact base-10 values without coercing through number', () => {
    expect(decimal('9007199254740993.00000001')).toBe('9007199254740993.00000001');
    expect(nonNegativeDecimal('0.00000001')).toBe('0.00000001');
  });

  it.each(['1e-8', '01.2', 'NaN', 'Infinity', '-0', ' 1'])('rejects non-canonical value %s', (value) => {
    expect(() => decimal(value)).toThrow(TypeError);
  });

  it('narrows only canonical decimal strings', () => {
    expect(isDecimalString('-12.50')).toBe(true);
    expect(isDecimalString(12.5)).toBe(false);
  });
});

describe('canonical instrument identity', () => {
  it('keys by venue product identity', () => {
    expect(instrumentKey(bitcoin)).toBe('coinbase|spot|BTC-USD');
  });

  it('does not depend on a display symbol', () => {
    expect(sameInstrument(bitcoin, { ...bitcoin })).toBe(true);
    expect(sameInstrument(bitcoin, { ...bitcoin, productId: 'BTC-USDC' })).toBe(false);
  });

  it('rejects ambiguous key delimiters', () => {
    expect(() => instrumentKey({ ...bitcoin, productId: 'BTC|USD' })).toThrow(TypeError);
  });
});
