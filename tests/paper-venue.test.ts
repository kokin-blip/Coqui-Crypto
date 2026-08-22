import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  DEFAULT_TRADE_COST_CONFIG,
  GUARD_TRADE_COST_CONFIG,
  type InstrumentIdentity,
  type MarketBar,
  type MarketBarQuality,
  type ProductRuleSnapshot,
} from '../packages/core/src/index.js';
import {
  executionModelFor,
  isFilled,
  selectExecutionBar,
  simulateFill,
} from '../packages/services/src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const BTC: InstrumentIdentity = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };
const BTC_KEY = instrumentKey(BTC);

const RULES: ProductRuleSnapshot = {
  id: 'a'.repeat(64),
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
  baseMaxSize: null,
  quoteMinSize: '1',
  quoteMaxSize: null,
  source: 'coinbase',
  retrievedAt: T0,
  responseHash: 'b'.repeat(64),
};

function bar(dayIndex: number, open: number, close: number, quality?: MarketBarQuality): MarketBar {
  return {
    assetId: BTC_KEY,
    source: 'coinbase',
    interval: '1d',
    startTimeMs: T0 + dayIndex * DAY,
    endTimeMs: T0 + (dayIndex + 1) * DAY,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 100,
    isComplete: true,
    retrievedAtMs: T0,
    ...(quality === undefined ? {} : { quality }),
  } as MarketBar;
}

const BARS = [bar(0, 100, 110), bar(1, 111, 120), bar(2, 121, 130)];

function fill(overrides: Partial<Parameters<typeof simulateFill>[0]> = {}) {
  return simulateFill({
    instrument: BTC,
    symbol: 'BTC',
    side: 'buy',
    requestedUsd: '250.00',
    availableCashUsd: '10000.00',
    rules: RULES,
    bars: BARS,
    // Decided at the close of day 0, so day 1 is the execution bar.
    decidedAtMs: T0 + DAY,
    ...overrides,
  });
}

describe('execution bar selection (invariant 6)', () => {
  it('never fills on a bar the signal could already see', () => {
    // Decision at the day-1 boundary: day 0 has closed and is visible, so the
    // earliest eligible bar is day 1 — the engine's opens[i] against
    // closes[0..i-1].
    const selected = selectExecutionBar(BARS, T0 + DAY);
    expect(selected?.startTimeMs).toBe(T0 + DAY);

    const result = fill();
    expect(isFilled(result)).toBe(true);
    if (!isFilled(result)) return;
    expect(result.executionBarStartMs).toBe(T0 + DAY);
    // Day 1's open, not day 0's close and not day 1's close.
    expect(result.referencePrice).toBe('111');
  });

  it('takes the earliest eligible bar even when input is unordered', () => {
    const shuffled = [BARS[2]!, BARS[0]!, BARS[1]!];
    expect(selectExecutionBar(shuffled, T0 + DAY)?.startTimeMs).toBe(T0 + DAY);
  });

  it('refuses when no bar opens at or after the decision', () => {
    const result = fill({ decidedAtMs: T0 + 10 * DAY });
    expect(isFilled(result)).toBe(false);
    if (isFilled(result)) return;
    expect(result.code).toBe('no_execution_bar');
  });

  it('refuses to price against an unclosed bar', () => {
    const open = { ...bar(1, 111, 120), isComplete: false } as MarketBar;
    const result = fill({ bars: [BARS[0]!, open] });
    expect(isFilled(result)).toBe(false);
    if (isFilled(result)) return;
    expect(result.code).toBe('execution_bar_incomplete');
  });

  it('stamps the fill at the execution bar, not the decision', () => {
    const result = fill({ decidedAtMs: T0 + DAY - 1 });
    expect(isFilled(result)).toBe(true);
    if (!isFilled(result)) return;
    // Stamping the decision time would misreport fill latency to the
    // reconciliation harness.
    expect(result.filledAtMs).toBe(T0 + DAY);
  });
});

describe('execution model mirrors the backtest engine', () => {
  it('uses opens only when every bar is provider-reported', () => {
    expect(executionModelFor(BARS)).toBe('next_open');
    expect(executionModelFor([...BARS, bar(3, 131, 140, 'reported_ohlc')])).toBe('next_open');
  });

  it('downgrades the whole set when any bar is not reported', () => {
    // A mixed series would price some fills at an open and others at a close
    // without saying so, which is what backtestDecisionDataset also refuses.
    for (const quality of ['close_only_legacy', 'synthetic_ohlc'] as const) {
      const mixed = [bar(0, 100, 110, quality), bar(1, 111, 120)];
      expect(executionModelFor(mixed)).toBe('next_close_conservative');
    }
  });

  it('prices from the close under the conservative model and says so', () => {
    const mixed = [bar(0, 100, 110, 'close_only_legacy'), bar(1, 111, 120)];
    const result = fill({ bars: mixed });
    expect(isFilled(result)).toBe(true);
    if (!isFilled(result)) return;
    expect(result.executionModel).toBe('next_close_conservative');
    expect(result.referencePrice).toBe('120');
  });
});

describe('costs', () => {
  it('folds spread, slippage and impact into the price but not the fee', () => {
    const result = fill();
    expect(isFilled(result)).toBe(true);
    if (!isFilled(result)) return;

    // A buy pays up from the reference by the three execution components.
    expect(Number(result.executionPrice)).toBeGreaterThan(Number(result.referencePrice));
    // The fee is charged on top rather than moving the price traded at; it
    // becomes its own ledger leg.
    expect(Number(result.venueFee)).toBeGreaterThan(0);

    const adjustment =
      (Number(result.executionPrice) - Number(result.referencePrice)) * Number(result.quantity);
    const components =
      Number(result.spreadCost) + Number(result.slippageCost) + Number(result.impactCost);
    expect(adjustment).toBeCloseTo(components, 6);
  });

  it('moves a sell in the opposite direction', () => {
    const result = fill({ side: 'sell' });
    expect(isFilled(result)).toBe(true);
    if (!isFilled(result)) return;
    expect(Number(result.executionPrice)).toBeLessThan(Number(result.referencePrice));
  });

  it('charges no impact under the default profile and does under the guard profile', () => {
    const standard = fill();
    const guarded = fill({ costConfig: GUARD_TRADE_COST_CONFIG });
    expect(isFilled(standard) && Number(standard.impactCost)).toBe(0);
    expect(isFilled(guarded) && Number(guarded.impactCost)).toBeGreaterThan(0);
  });

  it('defaults to the shared cost profile rather than accepting a caller number', () => {
    // Invariant 14: the predecessor's defect was a sweep passing 10bps against
    // an 85bps app default. Omitting the config must give the shared profile.
    const implicit = fill();
    const explicit = fill({ costConfig: DEFAULT_TRADE_COST_CONFIG });
    expect(isFilled(implicit) && implicit.executionPrice).toBe(
      isFilled(explicit) ? explicit.executionPrice : null,
    );
  });
});

describe('product rules govern the fill', () => {
  it('refuses and forwards the venue’s own reason', () => {
    const result = fill({ rules: { ...RULES, tradingDisabled: true } });
    expect(isFilled(result)).toBe(false);
    if (isFilled(result)) return;
    expect(result.code).toBe('rules_reject');
    expect(result.reason).toContain('do not permit');
  });

  it('refuses an order below the venue minimum', () => {
    const result = fill({ requestedUsd: '0.50', rules: { ...RULES, quoteMinSize: '10' } });
    expect(isFilled(result)).toBe(false);
  });

  it('never fills more than the available cash', () => {
    const result = fill({ requestedUsd: '5000.00', availableCashUsd: '100.00' });
    expect(isFilled(result)).toBe(true);
    if (!isFilled(result)) return;
    expect(Number(result.notional)).toBeLessThanOrEqual(100);
  });
});
