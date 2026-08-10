import { describe, expect, it } from 'vitest';
import {
  canTransitionPaperOrder,
  instrumentKey,
  normalizePaperOrder,
  paperExecutionPrice,
  paperFillLedgerEntries,
  type InstrumentIdentity,
  type ProductRuleSnapshot,
} from '../packages/core/src/index.js';

const BTC: InstrumentIdentity = {
  venue: 'coinbase',
  productId: 'BTC-USD',
  productType: 'spot',
};

const RULES: ProductRuleSnapshot = {
  id: 'rules-1',
  instrument: BTC,
  status: 'online',
  tradingDisabled: false,
  cancelOnly: false,
  limitOnly: false,
  postOnly: false,
  viewOnly: false,
  baseIncrement: '0.00000001',
  quoteIncrement: '0.01',
  priceIncrement: '0.01',
  baseMinSize: '0.00000001',
  baseMaxSize: '100',
  quoteMinSize: '1',
  quoteMaxSize: '1000000',
  source: 'coinbase',
  retrievedAt: 1,
  responseHash: 'a'.repeat(64),
};

function sumDecimalStrings(values: readonly string[]): bigint {
  const scale = Math.max(
    0,
    ...values.map((value) => value.split('.')[1]?.length ?? 0),
  );
  return values.reduce((sum, value) => {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [whole = '0', fraction = ''] = unsigned.split('.');
    const units = BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
    return sum + (negative ? -units : units);
  }, 0n);
}

describe('paper order model', () => {
  it('enforces the shared OMS transitions, including ambiguous submission state', () => {
    expect(canTransitionPaperOrder('proposed', 'risk_approved')).toBe(true);
    expect(canTransitionPaperOrder('submission_pending', 'unknown')).toBe(true);
    expect(canTransitionPaperOrder('unknown', 'acknowledged')).toBe(true);
    expect(canTransitionPaperOrder('open', 'partially_filled')).toBe(true);
    expect(canTransitionPaperOrder('filled', 'submitted')).toBe(false);
  });

  it('uses exact decimals and never rounds above available cash', () => {
    const normalized = normalizePaperOrder('100.005', '30000.123456789', RULES, '100.005');
    expect(normalized).toEqual({
      accepted: true,
      quantity: '0.00333348',
      notionalUsd: '100',
      reason: null,
    });
    expect(Number(normalized.notionalUsd)).toBeLessThanOrEqual(100.005);
  });

  it('blocks products whose immutable rule snapshot does not permit a market order', () => {
    expect(normalizePaperOrder('100', '50000', { ...RULES, tradingDisabled: true }, '100').accepted)
      .toBe(false);
    expect(normalizePaperOrder('100', '50000', { ...RULES, viewOnly: true }, '100').accepted)
      .toBe(false);
  });

  it('moves spread, slippage, and impact into execution price', () => {
    expect(
      paperExecutionPrice({
        side: 'buy',
        referencePrice: '100',
        quantity: '2',
        spreadCost: '1',
        slippageCost: '2',
        impactCost: '3',
      }),
    ).toBe('103');
    expect(
      paperExecutionPrice({
        side: 'sell',
        referencePrice: '100',
        quantity: '2',
        spreadCost: '1',
        slippageCost: '2',
        impactCost: '3',
      }),
    ).toBe('97');
  });

  it('creates exact balanced ledger postings keyed by canonical instrument', () => {
    for (const side of ['buy', 'sell'] as const) {
      const entries = paperFillLedgerEntries({
        instrument: BTC,
        side,
        quantity: '0.00000003',
        executionPrice: '33333.33333333',
        venueFee: '0.123456789',
      });
      expect(sumDecimalStrings(entries.map((entry) => entry.amountUsd))).toBe(0n);
      expect(entries.find((entry) => entry.account === 'venue_fee')?.amountUsd).toBe(
        '0.123456789',
      );
      expect(entries.find((entry) => entry.account === 'asset')?.instrument).toBe(
        instrumentKey(BTC),
      );
    }
  });
});
