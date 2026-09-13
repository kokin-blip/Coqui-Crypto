import { describe, expect, it, vi } from 'vitest';

import {
  fetchCoinbaseFeeTierEvidence,
  type CoinbaseReadHttpClient,
} from '../packages/adapters/src/index.js';

describe('Coinbase fee-tier evidence adapter', () => {
  it('retains exact fee strings and ignores floating aggregate fields', async () => {
    const getJson = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        fee_tier: {
          pricing_tier: 'Advanced 1',
          maker_fee_rate: '0.004000000000000001',
          taker_fee_rate: '0.006000000000000002',
          usd_from: '0',
          usd_to: '10000.000000000000001',
        },
        total_fees: 1.2345678901234567,
        coinbase_pro_fees: 99,
      },
    }));

    await expect(fetchCoinbaseFeeTierEvidence({ getJson } as unknown as Pick<
      CoinbaseReadHttpClient, 'getJson'
    >)).resolves.toEqual({
      ok: true,
      value: {
        pricingTier: 'Advanced 1',
        makerFeeRate: '0.004000000000000001',
        takerFeeRate: '0.006000000000000002',
        usdFrom: '0',
        usdTo: '10000.000000000000001',
      },
    });
    expect(getJson).toHaveBeenCalledWith(
      'https://api.coinbase.com/api/v3/brokerage/transaction_summary?product_type=SPOT&product_venue=CBE',
      undefined,
    );
  });

  it('uses the documented AOP range when Coinbase leaves legacy USD ranges empty', async () => {
    const getJson = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        fee_tier: {
          pricing_tier: 'Advanced 1',
          maker_fee_rate: '0.004',
          taker_fee_rate: '0.006',
          usd_from: '',
          usd_to: '',
          aop_from: '0',
          aop_to: '10000',
        },
      },
    }));

    await expect(fetchCoinbaseFeeTierEvidence({ getJson } as unknown as Pick<
      CoinbaseReadHttpClient, 'getJson'
    >)).resolves.toEqual({
      ok: true,
      value: {
        pricingTier: 'Advanced 1',
        makerFeeRate: '0.004',
        takerFeeRate: '0.006',
        usdFrom: '0',
        usdTo: '10000',
      },
    });
  });

  it('rejects non-string and exponent fee values instead of rounding them', async () => {
    const getJson = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: { fee_tier: {
        pricing_tier: 'Advanced 1', maker_fee_rate: 0.004,
        taker_fee_rate: '6e-3', usd_from: '0', usd_to: null,
      } },
    }));
    await expect(fetchCoinbaseFeeTierEvidence({ getJson } as unknown as Pick<
      CoinbaseReadHttpClient, 'getJson'
    >)).resolves.toEqual({ ok: false, code: 'invalid_response' });
  });

  it('normalizes thrown transport failures', async () => {
    const getJson = vi.fn(async () => { throw new Error('secret response body'); });
    await expect(fetchCoinbaseFeeTierEvidence({ getJson } as unknown as Pick<
      CoinbaseReadHttpClient, 'getJson'
    >)).resolves.toEqual({ ok: false, code: 'network' });
  });
});
