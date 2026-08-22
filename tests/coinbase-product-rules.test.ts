import { describe, expect, it, vi } from 'vitest';

import {
  fetchCoinbaseProductRules,
  type CoinbaseProductRuleEnrichment,
  type HttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';
import { normalizePaperOrder } from '../packages/core/src/index.js';

const NOW = 1_724_000_000_000;

/** A complete Coinbase Exchange `/products` row for a USD spot pair. */
function product(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'BTC-USD',
    base_currency: 'BTC',
    quote_currency: 'USD',
    status: 'online',
    trading_disabled: false,
    cancel_only: false,
    limit_only: false,
    post_only: false,
    base_increment: '0.00000001',
    quote_increment: '0.01',
    min_market_funds: '1',
    ...overrides,
  };
}

function client(data: unknown, failure?: HttpResult<unknown>): HttpClient {
  return {
    async getJson<T>(): Promise<HttpResult<T>> {
      return (failure ?? { ok: true, data, status: 200 }) as HttpResult<T>;
    },
    async postJson<T>(): Promise<HttpResult<T>> {
      return { ok: false, status: 405, reason: 'http', retried: 0 };
    },
    async getText(): Promise<HttpResult<string>> {
      return { ok: false, status: 405, reason: 'http', retried: 0 };
    },
    destroy() {},
  };
}

describe('product rules mapping', () => {
  it('produces a snapshot normalizePaperOrder actually accepts', async () => {
    const result = await fetchCoinbaseProductRules(client([product()]), { nowMs: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rules = result.rules[0];
    expect(rules).toBeDefined();
    if (rules === undefined) return;

    // The point of the adapter: before it existed nothing could normalise an
    // order at all, because ProductRuleSnapshot had no producer.
    const normalized = normalizePaperOrder('250.00', '64000.00', rules, '1000.00');
    expect(normalized.accepted).toBe(true);
    expect(normalized.reason).toBeNull();
    expect(Number(normalized.notionalUsd)).toBeGreaterThan(0);
  });

  it('maps the fields the endpoint does not publish directly', async () => {
    const result = await fetchCoinbaseProductRules(client([product()]), { nowMs: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rules = result.rules[0]!;

    // quote_increment is the price tick on this endpoint; there is no separate field.
    expect(rules.priceIncrement).toBe('0.01');
    // The Exchange endpoint no longer publishes a base minimum; the smallest
    // tradeable unit is the honest floor, and the $25 useful-trade guardrail
    // already refuses dust far above it.
    expect(rules.baseMinSize).toBe('0.00000001');
    expect(rules.quoteMinSize).toBe('1');
    // Not published. Inventing a cap would be a fabricated constraint.
    expect(rules.baseMaxSize).toBeNull();
    expect(rules.quoteMaxSize).toBeNull();
    expect(rules.retrievedAt).toBe(NOW);
    expect(rules.responseHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(rules.source).toBe('coinbase');
  });
});

describe('refusing rather than defaulting', () => {
  it('omits a product with a missing or non-positive increment', async () => {
    const rows = [
      product({ id: 'A-USD', base_increment: undefined }),
      product({ id: 'B-USD', quote_increment: '0' }),
      product({ id: 'C-USD', min_market_funds: undefined }),
      product({ id: 'D-USD', base_increment: 'abc' }),
      product({ id: 'GOOD-USD' }),
    ];
    const result = await fetchCoinbaseProductRules(client(rows), { nowMs: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Without the venue's own numbers a simulated fill would be measured
    // against values Coqui invented.
    expect(result.rules.map((rule) => rule.instrument.productId)).toEqual(['GOOD-USD']);
  });

  it('treats an absent safety flag as engaged', async () => {
    const result = await fetchCoinbaseProductRules(
      client([product({ trading_disabled: undefined, cancel_only: undefined })]),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rules = result.rules[0]!;
    // Not knowing is not permission.
    expect(rules.tradingDisabled).toBe(true);
    expect(rules.cancelOnly).toBe(true);
    // And the effect is real: normalisation refuses it.
    expect(normalizePaperOrder('250.00', '64000.00', rules, '1000.00').accepted).toBe(false);
  });

  it('keeps viewOnly false, since the endpoint has no such concept', async () => {
    const result = await fetchCoinbaseProductRules(client([product()]), { nowMs: NOW });
    expect(result.ok && result.rules[0]?.viewOnly).toBe(false);
  });

  it('skips a non-USD pair without failing the batch', async () => {
    const result = await fetchCoinbaseProductRules(
      client([product({ id: 'BTC-EUR', quote_currency: 'EUR' }), product()]),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rules).toHaveLength(1);
  });

  it('does not let one malformed listing stop paper trading on every other pair', async () => {
    const result = await fetchCoinbaseProductRules(
      client([{ nonsense: true }, product()]),
      { nowMs: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rules).toHaveLength(1);
  });

  it('still fails a malformed response, which is the venue breaking its own contract', async () => {
    const notAnArray = await fetchCoinbaseProductRules(client({ products: [] }), { nowMs: NOW });
    expect(notAnArray).toEqual({ ok: false, code: 'invalid_response' });
  });

  it('names the transport failure', async () => {
    for (const [http, code] of [
      [{ ok: false, status: 429, reason: 'http', retried: 0 }, 'rate_limited'],
      [{ ok: false, status: 0, reason: 'network', retried: 0 }, 'network'],
      [{ ok: false, status: 0, reason: 'timeout', retried: 0 }, 'timeout'],
      [{ ok: false, status: 0, reason: 'canceled', retried: 0 }, 'cancelled'],
    ] as const) {
      const result = await fetchCoinbaseProductRules(
        client(null, http as HttpResult<unknown>),
        { nowMs: NOW },
      );
      expect(result).toEqual({ ok: false, code });
    }
  });
});

describe('authenticated enrichment', () => {
  it('overlays fields the public endpoint cannot supply', async () => {
    const enrichment: CoinbaseProductRuleEnrichment = {
      source: 'advanced-trade',
      rules: async () => ({ baseMinSize: '0.0001', baseMaxSize: '100', viewOnly: false }),
    };
    const result = await fetchCoinbaseProductRules(client([product()]), {
      nowMs: NOW,
      enrichment,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rules[0]).toMatchObject({ baseMinSize: '0.0001', baseMaxSize: '100' });
  });

  it('degrades to the keyless base when the overlay throws', async () => {
    const enrichment: CoinbaseProductRuleEnrichment = {
      source: 'advanced-trade',
      rules: vi.fn(async () => {
        throw new Error('401 unauthorised');
      }),
    };
    const result = await fetchCoinbaseProductRules(client([product()]), {
      nowMs: NOW,
      enrichment,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A missing or expired credential must not lose the product; the base
    // mapping is still valid on its own.
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.baseMinSize).toBe('0.00000001');
  });

  it('discards an overlay that would make the rules unusable', async () => {
    const enrichment: CoinbaseProductRuleEnrichment = {
      source: 'advanced-trade',
      rules: async () => ({ quoteMinSize: '0' }),
    };
    const result = await fetchCoinbaseProductRules(client([product()]), {
      nowMs: NOW,
      enrichment,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // An authenticated source is not automatically more trustworthy than the
    // public one; a non-positive minimum is refused from either.
    expect(result.rules[0]?.quoteMinSize).toBe('1');
  });

  it('leaves the base untouched when the overlay returns null', async () => {
    const enrichment: CoinbaseProductRuleEnrichment = {
      source: 'advanced-trade',
      rules: async () => null,
    };
    const result = await fetchCoinbaseProductRules(client([product()]), {
      nowMs: NOW,
      enrichment,
    });
    expect(result.ok && result.rules[0]?.baseMinSize).toBe('0.00000001');
  });
});
