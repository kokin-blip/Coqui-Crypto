import { describe, expect, it } from 'vitest';

import {
  validateAllocationPolicy,
  type AllocationPolicy,
  type InstrumentIdentity,
} from '@coqui/core';

const BTC: InstrumentIdentity = {
  venue: 'coinbase',
  productId: 'BTC-USD',
  productType: 'spot',
};
const ETH: InstrumentIdentity = {
  venue: 'coinbase',
  productId: 'ETH-USD',
  productType: 'spot',
};

describe('allocation policy validation', () => {
  it('collects every path-aware issue in deterministic order', () => {
    const result = validateAllocationPolicy({
      targets: [
        { instrument: BTC, weight: 0 },
        { instrument: BTC, weight: 2 },
        {
          instrument: { venue: 'kraken', productId: 'ETH-USD', productType: 'spot' },
          weight: 0.5,
        },
      ],
      rebalanceBandPct: 0,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        { code: 'invalid_weight', path: 'targets[0].weight' },
        { code: 'duplicate_instrument', path: 'targets[1].instrument' },
        { code: 'invalid_weight', path: 'targets[1].weight' },
        { code: 'invalid_instrument', path: 'targets[2].instrument' },
        { code: 'weight_sum_not_one', path: 'targets' },
        { code: 'invalid_rebalance_band', path: 'rebalanceBandPct' },
      ],
    });
    if (!result.ok) {
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.issues)).toBe(true);
      expect(result.issues.every(Object.isFrozen)).toBe(true);
    }
  });

  it('requires explicit targets and a valid finite band', () => {
    expect(validateAllocationPolicy({
      targets: [],
      rebalanceBandPct: Number.NaN,
    })).toEqual({
      ok: false,
      issues: [
        { code: 'targets_required', path: 'targets' },
        { code: 'invalid_rebalance_band', path: 'rebalanceBandPct' },
      ],
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 0, 1.1])(
    'rejects invalid target weight %s',
    (weight) => {
      const result = validateAllocationPolicy({
        targets: [{ instrument: BTC, weight }],
        rebalanceBandPct: 5,
      });
      expect(result).toEqual({
        ok: false,
        issues: [
          { code: 'invalid_weight', path: 'targets[0].weight' },
          { code: 'weight_sum_not_one', path: 'targets' },
        ],
      });
    },
  );

  it('accepts the documented sum tolerance and returns a canonical detached policy', () => {
    const mutableBtc = { ...BTC };
    const mutablePolicy: AllocationPolicy = {
      targets: [
        { instrument: ETH, weight: 0.499999999 },
        { instrument: mutableBtc, weight: 0.5000000005 },
      ],
      rebalanceBandPct: 5,
    };
    const result = validateAllocationPolicy(mutablePolicy);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy.targets.map((target) => target.instrument.productId))
      .toEqual(['BTC-USD', 'ETH-USD']);
    mutableBtc.productId = 'MUTATED-USD';
    expect(result.policy.targets[0]?.instrument.productId).toBe('BTC-USD');
    expect(Object.isFrozen(result.policy)).toBe(true);
    expect(Object.isFrozen(result.policy.targets)).toBe(true);
    expect(Object.isFrozen(result.policy.targets[0]?.instrument)).toBe(true);
  });

  it('rejects a sum outside tolerance and malformed canonical identity', () => {
    expect(validateAllocationPolicy({
      targets: [
        {
          instrument: { venue: 'coinbase', productId: 'BAD|USD', productType: 'spot' },
          weight: 0.4,
        },
        { instrument: ETH, weight: 0.5 },
      ],
      rebalanceBandPct: 100.1,
    })).toEqual({
      ok: false,
      issues: [
        { code: 'invalid_instrument', path: 'targets[0].instrument' },
        { code: 'weight_sum_not_one', path: 'targets' },
        { code: 'invalid_rebalance_band', path: 'rebalanceBandPct' },
      ],
    });
  });
});
