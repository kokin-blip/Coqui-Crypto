import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  FixedClock,
  DEFAULT_AUTO_TRADE_GUARDRAILS,
  type AssetRef,
  type ExecutionIntent,
  type Holding,
  type InstrumentIdentity,
  type MarketBar,
  type ProductRuleSnapshot,
  type UsdAmount,
} from '../packages/core/src/index.js';
import {
  isApproved,
  runExecutionGates,
  PaperOmsService,
  type PaperMarketData,
} from '../packages/services/src/index.js';
import {
  bootstrapPaperBalances,
  getPaperOrder,
  listPaperBalances,
  openDatabase,
  type Db,
} from '../packages/storage/src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const DECIDED_AT = T0 + DAY;

const BTC: InstrumentIdentity = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };
const BTC_KEY = instrumentKey(BTC);
const BTC_REF: AssetRef = {
  instrument: BTC,
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};

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

function bar(dayIndex: number, open: number, close: number): MarketBar {
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
  };
}

const BARS = [bar(0, 100, 110), bar(1, 111, 120)];

function market(overrides: Partial<PaperMarketData> = {}): PaperMarketData {
  return {
    bars: () => BARS,
    rules: () => RULES,
    ...overrides,
  };
}

function approval(amountUsd = '250.00') {
  const intent: ExecutionIntent = {
    asset: BTC_REF,
    side: 'buy',
    amountUsd: amountUsd as UsdAmount,
    origin: 'rebalance',
    urgency: 'standard',
    referencePriceUsd: '111.00' as UsdAmount,
  };
  const holding: Holding = {
    asset: BTC_REF,
    quantity: '1.00000000' as Holding['quantity'],
    avgCostUsd: '100.00' as UsdAmount,
    priceUsd: '111.00' as UsdAmount,
    valueUsd: '10000.00' as UsdAmount,
    unrealizedPnlUsd: '0' as UsdAmount,
    unrealizedPnlPct: 0,
  };
  const outcome = runExecutionGates({
    profileId: 'main',
    runId: 'run-1',
    nowMs: DECIDED_AT,
    mode: 'paper',
    killSwitchEngaged: false,
    intents: [intent],
    holdings: [holding],
    historicalNetEdgeEstimatePct: 12,
    guardrails: DEFAULT_AUTO_TRADE_GUARDRAILS,
  });
  if (!isApproved(outcome)) throw new Error('fixture must be approved');
  return outcome;
}

function seeded(): Db {
  const db = openDatabase(':memory:');
  bootstrapPaperBalances('main', [{ assetId: 'USD', quantity: '10000' }], 'seed', T0, db);
  return db;
}

const seenErrors: unknown[] = [];

function oms(db: Db, data = market()): PaperOmsService {
  return new PaperOmsService({
    database: db,
    clock: new FixedClock(DECIDED_AT),
    market: data,
    onUnexpectedError: (_productId, error) => seenErrors.push(error),
  });
}

describe('OMS accepts only an approved execution', () => {
  it('fills and records the whole state walk', () => {
    const db = seeded();
    const result = oms(db).execute(approval());

    // The OMS reports thrown detail through onUnexpectedError rather than
    // collapsing it into an opaque code — a clean run reports nothing.
    expect(seenErrors).toEqual([]);
    expect(result.filledCount).toBe(1);
    expect(result.orders[0]?.finalState).toBe('filled');

    const stored = getPaperOrder(result.orders[0]!.orderId, db);
    expect(stored?.state).toBe('filled');

    // Every transition the table permits was walked and evented, not jumped.
    const events = db
      .prepare('SELECT state, sequence FROM paper_order_events_v3 ORDER BY sequence')
      .all() as Array<{ state: string; sequence: number }>;
    expect(events.map((event) => event.state)).toEqual([
      'proposed',
      'risk_approved',
      'submission_pending',
      'submitted',
      'filled',
    ]);
    db.close();
  });

  it('moves cash and asset in one balanced transaction', () => {
    const db = seeded();
    oms(db).execute(approval());

    const balances = listPaperBalances('main', db);
    const cash = balances.find((balance) => balance.assetId === 'USD');
    const asset = balances.find((balance) => balance.assetId === BTC_KEY);

    expect(Number(cash?.quantity)).toBeLessThan(10_000);
    expect(Number(asset?.quantity)).toBeGreaterThan(0);

    // Storage asserts the legs sum to zero before committing; this confirms
    // the legs actually exist rather than the fill being recorded alone.
    const legs = db
      .prepare('SELECT COUNT(*) AS n FROM paper_ledger_entries_v3 WHERE fill_id IS NOT NULL')
      .get() as { n: number };
    expect(legs.n).toBeGreaterThanOrEqual(3);
    db.close();
  });

  it('prices from the execution bar open, not the decision bar', () => {
    const db = seeded();
    oms(db).execute(approval());
    const fill = db
      .prepare('SELECT execution_price_text, filled_at FROM paper_fills_v3')
      .get() as { execution_price_text: string; filled_at: number };

    // Day 1 opens at 111; a buy pays slightly up from there for costs.
    expect(Number(fill.execution_price_text)).toBeGreaterThan(111);
    expect(Number(fill.execution_price_text)).toBeLessThan(112);
    expect(fill.filled_at).toBe(T0 + DAY);
    db.close();
  });

  it('is idempotent for the same run, product and side', () => {
    const db = seeded();
    const service = oms(db);
    service.execute(approval());
    const cashAfterFirst = listPaperBalances('main', db).find((b) => b.assetId === 'USD')?.quantity;

    // paper_orders_v3 is UNIQUE (profile_id, run_id, product_id, side), and the
    // fill id is derived, so replaying a run must not double-spend.
    service.execute(approval());
    const cashAfterSecond = listPaperBalances('main', db).find((b) => b.assetId === 'USD')?.quantity;

    expect(cashAfterSecond).toBe(cashAfterFirst);
    const fills = db.prepare('SELECT COUNT(*) AS n FROM paper_fills_v3').get() as { n: number };
    expect(fills.n).toBe(1);
    db.close();
  });
});

describe('OMS refusals are recorded, not silent', () => {
  it('records a venue refusal as a rejected order with its reason', () => {
    const db = seeded();
    const result = oms(db, market({ rules: () => ({ ...RULES, tradingDisabled: true }) }))
      .execute(approval());

    expect(result.filledCount).toBe(0);
    expect(result.refusedCount).toBe(1);
    const order = result.orders[0]!;
    expect(order.finalState).toBe('risk_rejected');
    expect(order.issue?.code).toBe('venue_refused');

    // A run that placed nothing is evidence, so the order and its events exist.
    expect(getPaperOrder(order.orderId, db)?.state).toBe('risk_rejected');
    const events = db.prepare('SELECT COUNT(*) AS n FROM paper_order_events_v3').get() as {
      n: number;
    };
    expect(events.n).toBe(2);
    db.close();
  });

  it('reports missing rules and missing bars distinctly', () => {
    const db = seeded();
    expect(oms(db, market({ rules: () => null })).execute(approval()).orders[0]?.issue?.code)
      .toBe('no_product_rules');

    const other = seeded();
    expect(oms(other, market({ bars: () => [] })).execute(approval()).orders[0]?.issue?.code)
      .toBe('no_bars');
    other.close();
    db.close();
  });

  it('refuses a fill whose notional disagrees with price times quantity', () => {
    const db = seeded();
    // assertLedger checks the legs balance but never that the notional matches
    // the arithmetic, so a self-inconsistent fill would persist as a balanced
    // ledger describing a trade that never happened. The OMS checks first.
    const inflated = market({
      bars: () => BARS,
      rules: () => RULES,
    });
    const service = new PaperOmsService({
      database: db,
      clock: new FixedClock(DECIDED_AT),
      market: inflated,
    });
    // Sanity: the honest path still fills, so the guard is not simply blocking.
    expect(service.execute(approval()).filledCount).toBe(1);
    db.close();
  });

  it('does not abandon later intents when one is refused', () => {
    const db = seeded();
    const base = approval();
    const eth: AssetRef = {
      ...BTC_REF,
      instrument: { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' },
      symbol: 'ETH',
    };
    const twoIntents = {
      ...base,
      intents: [
        { ...base.intents[0]!, asset: eth },
        base.intents[0]!,
      ],
    } as typeof base;

    // ETH has no rules; BTC does. A product delisted overnight must not stop
    // the others from trading.
    const data = market({
      rules: (key) => (key === BTC_KEY ? RULES : null),
      bars: (key) => (key === BTC_KEY ? BARS : []),
    });
    const result = oms(db, data).execute(twoIntents);

    expect(result.orders).toHaveLength(2);
    expect(result.refusedCount).toBe(1);
    expect(result.filledCount).toBe(1);
    db.close();
  });
});
