import { describe, expect, it } from 'vitest';

import type { AllocationPolicy, InstrumentIdentity } from '@coqui/core';
import { PortfolioAllocationPolicyService } from '@coqui/services';
import {
  getAllocationPolicy,
  openDatabase,
  saveAllocationPolicy,
} from '@coqui/storage';

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

function initialPolicy(): AllocationPolicy {
  return {
    targets: [{ instrument: BTC, weight: 1 }],
    rebalanceBandPct: 4,
  };
}

describe('portfolio allocation policy service', () => {
  it('canonicalizes, detaches, freezes, and atomically saves a complete policy', () => {
    const database = openDatabase(':memory:');
    const service = new PortfolioAllocationPolicyService({ database });
    const mutableBtc = { ...BTC };
    const input: AllocationPolicy = {
      targets: [
        { instrument: ETH, weight: 0.4 },
        { instrument: mutableBtc, weight: 0.6 },
      ],
      rebalanceBandPct: 3,
    };

    const result = service.savePolicy(input);

    expect(result).toEqual({
      ok: true,
      policy: {
        targets: [
          { instrument: BTC, weight: 0.6 },
          { instrument: ETH, weight: 0.4 },
        ],
        rebalanceBandPct: 3,
      },
    });
    mutableBtc.productId = 'MUTATED-USD';
    expect(getAllocationPolicy(database)).toEqual(result.ok ? result.policy : null);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.policy.targets)).toBe(true);
      expect(Object.isFrozen(result.policy.targets[0]?.instrument)).toBe(true);
    }
    database.close();
  });

  it('returns every issue and preserves the complete prior policy', () => {
    const database = openDatabase(':memory:');
    saveAllocationPolicy(initialPolicy(), database);
    const service = new PortfolioAllocationPolicyService({ database });

    const result = service.savePolicy({
      targets: [
        { instrument: BTC, weight: 0 },
        { instrument: BTC, weight: 0.5 },
      ],
      rebalanceBandPct: Number.POSITIVE_INFINITY,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        { code: 'invalid_weight', path: 'targets[0].weight' },
        { code: 'duplicate_instrument', path: 'targets[1].instrument' },
        { code: 'weight_sum_not_one', path: 'targets' },
        { code: 'invalid_rebalance_band', path: 'rebalanceBandPct' },
      ],
    });
    expect(getAllocationPolicy(database)).toEqual(initialPolicy());
    database.close();
  });

  it('clears targets explicitly and restores the default band', () => {
    const database = openDatabase(':memory:');
    saveAllocationPolicy(initialPolicy(), database);
    const service = new PortfolioAllocationPolicyService({ database });

    const result = service.clearPolicy();

    expect(result).toEqual({
      ok: true,
      policy: { targets: [], rebalanceBandPct: 5 },
    });
    expect(getAllocationPolicy(database)).toEqual(result.policy);
    expect(Object.isFrozen(result.policy.targets)).toBe(true);
    database.close();
  });

  it('defends direct repository callers before replacing stored targets', () => {
    const database = openDatabase(':memory:');
    saveAllocationPolicy(initialPolicy(), database);

    expect(() => saveAllocationPolicy({
      targets: [{ instrument: ETH, weight: 0.5 }],
      rebalanceBandPct: 5,
    }, database)).toThrow('Allocation policy is invalid');
    expect(getAllocationPolicy(database)).toEqual(initialPolicy());
    database.close();
  });
});
