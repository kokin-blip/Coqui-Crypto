import { money } from '../packages/services/src/paper/parallel-paper-utils.js';
import { describe, expect, it, vi } from 'vitest';
import { createMemorySecretStore, AlpacaPaperError } from '../packages/adapters/src/index.js';
import { assetExposureKey, connectionAccountSnapshotV2Hash, FixedClock, instrumentKey, profileConnectionV2, sha256Hex,
  type ConnectionAccountSnapshotV2, type DecisionMarketDataset } from '../packages/core/src/index.js';
import { ParallelPaperService, PARALLEL_INSTRUMENTS, type PaperDecisionPreparation } from '../packages/services/src/index.js';
import { openDatabase, saveConnectionAccountSnapshotV2, saveProfileConnectionV2, setSetting } from '../packages/storage/src/index.js';
import { CHANNEL_SCHEMAS } from '../packages/contracts/src/index.js';

const TODAY = Date.parse('2026-09-24T00:06:00Z');
const DAY = 86_400_000;
const ACCOUNT = { id: 'paper-account-1234', status: 'PAPER_ONLY', currency: 'USD',
  cash: '100000', equity: '100000', trading_blocked: false, account_blocked: false };

function dataset(days = 121, end = '2026-09-23'): DecisionMarketDataset {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const dayKeys = Array.from({ length: days }, (_, index) =>
    new Date(endMs - (days - 1 - index) * DAY).toISOString().slice(0, 10));
  const closesById = Object.fromEntries(PARALLEL_INSTRUMENTS.map((asset, assetIndex) =>
    [instrumentKey(asset), dayKeys.map((_, index) => (assetIndex + 1) * 100 + index * (assetIndex + 1) * 0.1)]));
  return { dayKeys, assets: PARALLEL_INSTRUMENTS.map(instrumentKey),
    closesById, opensById: closesById, barsById: {} as DecisionMarketDataset['barsById'],
    report: {} as DecisionMarketDataset['report'], generatedAtMs: TODAY,
    sourcesByAsset: {} as DecisionMarketDataset['sourcesByAsset'],
    qualitiesByAsset: {} as DecisionMarketDataset['qualitiesByAsset'],
    latestRetrievedAtMsByAsset: {} as DecisionMarketDataset['latestRetrievedAtMsByAsset'] };
}

async function setup(openingUsd = '1000') {
  const database = openDatabase(':memory:');
  const clock = new FixedClock(TODAY), secrets = createMemorySecretStore();
  const connection = profileConnectionV2('main', 'coinbase', sha256Hex('key'), TODAY - 60_000);
  saveProfileConnectionV2(connection, database);
  const material = {
    schemaVersion: 2 as const, profileId: 'main', connectionId: connection.id, provider: 'coinbase' as const,
    asOfMs: TODAY - 1_000, balances: [{ accountRefId: sha256Hex('account'), exposureKey: assetExposureKey('USD'),
      instrument: null, availableQuantity: openingUsd, heldQuantity: '0', totalQuantity: openingUsd,
      priceUsd: '1', valueUsd: openingUsd }], cashUsd: openingUsd, buyingPowerUsd: openingUsd, pendingOrderIds: [],
    permissions: { accountRead: true, marketRead: true, orderRead: true, trade: false as const },
    rulesHash: null, feeEvidenceHash: null, health: 'healthy' as const, failureReason: null,
    complete: true, provenance: { source: 'coinbase' as const,
      requestedAtMs: TODAY - 2_000, receivedAtMs: TODAY - 1_000 },
  };
  const contentHash = connectionAccountSnapshotV2Hash({ ...material, id: '', contentHash: '' });
  const snapshot: ConnectionAccountSnapshotV2 = { ...material,
    id: sha256Hex(`connection-account-snapshot-v2:${contentHash}`), contentHash };
  saveConnectionAccountSnapshotV2(snapshot, database);
  setSetting('alpaca.paper.account.id', ACCOUNT.id, database);
  await secrets.write('alpaca-paper-credentials', JSON.stringify({ keyId: 'paper-key', secretKey: 'paper-secret' }), 'main');
  return { database, clock, secrets };
}

function mockClient(submitFailure = false, fillStatus = 'filled', quoteAtMs: number | (() => number) = TODAY) {
  const orders = new Map<string, { id: string; client_order_id: string; symbol: string; side: 'buy' | 'sell';
    status: string; qty: string; filled_qty: string; filled_avg_price: string }>();
  const submit = vi.fn(async (input: { client_order_id: string; symbol: string; side: 'buy' | 'sell'; qty: string }) => {
    if (submitFailure) throw new AlpacaPaperError('unavailable');
    const order = { id: sha256Hex(input.client_order_id), ...input, status: fillStatus,
      filled_qty: fillStatus === 'filled' ? input.qty : '0.0001', filled_avg_price: '100' };
    orders.set(input.client_order_id, order);
    return order;
  });
  return { client: {
    account: async () => ACCOUNT,
    positions: async () => {
      const quantities = new Map<string, ReturnType<typeof money>>();
      for (const order of orders.values()) quantities.set(order.symbol, (quantities.get(order.symbol) ?? money(0))
        .plus(money(order.filled_qty).mul(order.side === 'buy' ? 1 : -1)));
      return [...quantities].map(([symbol, qty]) => ({ symbol, qty: qty.toString(), market_value: qty.mul(100).toString() }));
    },
    orders: async () => [],
    asset: async (symbol: string) => ({ symbol, status: 'active', tradable: true,
      min_order_size: '0.0001', min_trade_increment: '0.0001' }),
    latestCryptoQuotes: async () => ({ quotes: Object.fromEntries(['BTC', 'ETH', 'LTC'].map((symbol) =>
      [`${symbol}/USD`, { bp: 100, ap: 101,
        t: new Date(typeof quoteAtMs === 'function' ? quoteAtMs() : quoteAtMs).toISOString() }])) }),
    activities: async () => [...orders.values()].map((order) => ({ id: `fill-${order.id}`, activity_type: 'FILL', order_id: order.id,
      symbol: order.symbol, qty: order.filled_qty, price: order.filled_avg_price, transaction_time: new Date(TODAY).toISOString() })),
    orderByClientId: async (id: string) => {
      const order = orders.get(id);
      if (order === undefined) throw new AlpacaPaperError('not_found');
      return order;
    },
    submit,
    cancel: async () => undefined,
  }, submit };
}

describe('paper settlement execution integration', () => {
  it('audits refused submissions across restart and requires manual Resume with every execution gate intact', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    mock.submit.mockRejectedValueOnce(new AlpacaPaperError('forbidden', 'submit', 403, 1));
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    let killed = false, badPositions = false, auditFailed = false;
    const create = () => new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared, killSwitchEngaged: () => killed,
      clientFactory: () => ({ ...mock.client,
        positions: async () => badPositions ? [{ symbol: 'BTCUSD', qty: '1', market_value: '100' }] : mock.client.positions(),
        activities: async () => { if (auditFailed) throw new AlpacaPaperError('unavailable', 'activities', 503); return mock.client.activities(); },
        orderByClientId: async (id: string) => { try { return await mock.client.orderByClientId(id); }
          catch { throw new AlpacaPaperError('not_found', 'order_lookup', 404, 1); } },
      }) as never });
    const service = create();
    await service.start('refused-submission', true); await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'submission_rejected' });
    const originalAttempts = service.status().events.filter(event => event.kind === 'submit_attempt');
    const rejectedId = String(originalAttempts[0]!.detail['clientOrderId']);
    expect(service.transition('resumed', 'too-early')).toBe(false);
    const restarted = create();
    auditFailed = true; await restarted.tick();
    expect(restarted.status().events.some(event => event.kind === 'submission_rejected')).toBe(false);
    expect(restarted.summary().reconciliationAttention.blocked).toBe(true);
    auditFailed = false; badPositions = true; await restarted.tick();
    expect(restarted.summary().reconciliationAttention.blocked).toBe(true);
    badPositions = false; killed = true; await restarted.tick();
    expect(restarted.transition('resumed', 'killed')).toBe(false);
    killed = false; await restarted.tick();
    expect(restarted.summary()).toMatchObject({ state: 'paused', reconciliationAttention: { blocked: false, unresolvedOrders: [] } });
    expect(mock.submit).toHaveBeenCalledTimes(1);
    expect(restarted.transition('resumed', 'manual-resume')).toBe(true);
    await restarted.tick();
    expect(mock.submit).toHaveBeenCalledTimes(1);
    clock.set(TODAY + 4 * 3_600_000); await restarted.tick();
    expect(mock.submit.mock.calls.length).toBeGreaterThan(1);
    expect(mock.submit.mock.calls.filter(([input]) => input.client_order_id === rejectedId)).toHaveLength(1);
    expect(restarted.status().events.filter(event => event.kind === 'submission_rejected')).toHaveLength(1);
    database.close();
  });

  it('continues active execution on independently proven net positions while fees post later, retaining manual pause and fresh-price guards', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const ready: PaperDecisionPreparation = { ok: true, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    let killed = false;
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets, preparation: () => ready,
      refreshFor: async () => ready, clientFactory: () => mock.client as never, killSwitchEngaged: () => killed });
    const net = new Map<string, ReturnType<typeof money>>();
    const fillTimes = new Map<string, string>(), activities = mock.client.activities;
    mock.client.activities = async () => (await activities()).map(row => ({ ...row, transaction_time: fillTimes.get(row.order_id)! }));
    const submit = mock.submit.getMockImplementation()!;
    mock.submit.mockImplementation(async input => {
      const order = await submit(input), qty = money(order.filled_qty);
      fillTimes.set(order.id, new Date(clock.nowMs()).toISOString());
      const debit = order.side === 'buy' ? qty.mul('0.0025').toDecimalPlaces(9, 0) : money(0);
      net.set(order.symbol, (net.get(order.symbol) ?? money(0)).plus(order.side === 'buy' ? qty.minus(debit) : qty.neg()));
      service.recordTradeUpdate(service.status().experiment!.id, { executionId: `fill-${order.id}`, orderId: order.id,
        clientOrderId: order.client_order_id, symbol: order.symbol, side: order.side, at: new Date(clock.nowMs()).toISOString(),
        quantity: order.filled_qty, filledQty: order.filled_qty, price: order.filled_avg_price, positionQty: net.get(order.symbol)!.toString() });
      return order;
    });
    mock.client.positions = async () => [...net].map(([symbol, qty]) => ({ symbol, qty: qty.toString(), market_value: qty.mul(100).toString() }));
    expect((await service.start('net-settlement', true)).ok).toBe(true);
    await service.tick(); const firstCount = mock.submit.mock.calls.length;
    expect(firstCount).toBe(3);
    clock.set(TODAY + 60_000); await service.tick();
    expect(service.summary()).toMatchObject({ state: 'active', reconciliationAttention: { blocked: false },
      brokerEvidence: { positionStatus: 'reconciled', settlement: { status: 'pending', assets: expect.any(Array) } } });
    expect(mock.submit).toHaveBeenCalledTimes(firstCount);
    expect(CHANNEL_SCHEMAS['parallel.paper.status'].response.unwrap().safeParse(service.summary()).success).toBe(true);
    expect(service.status().events.filter(event => event.kind === 'external_fee')).toHaveLength(0);
    clock.set(Date.parse('2026-09-24T08:01:00Z'));
    mock.client.latestCryptoQuotes = async () => ({ quotes: Object.fromEntries(['BTC', 'ETH', 'LTC'].map(symbol =>
      [`${symbol}/USD`, { bp: 200, ap: 201, t: new Date(clock.nowMs()).toISOString() }])) });
    await service.tick();
    expect(service.summary().state).toBe('active');
    expect(mock.submit.mock.calls.length).toBeGreaterThan(firstCount);
    const beforePause = mock.submit.mock.calls.length;
    service.transition('paused', 'manual'); clock.set(clock.nowMs() + 60_000); await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', reconciliationAttention: { blocked: false } });
    expect(mock.submit).toHaveBeenCalledTimes(beforePause);
    killed = true; expect(service.transition('resumed', 'kill-block')).toBe(false);
    killed = false; expect(service.transition('resumed', 'manual-resume')).toBe(true);
    mock.client.latestCryptoQuotes = async () => ({ quotes: { 'BTC/USD': { bp: 100, ap: 101, t: new Date(TODAY).toISOString() } } });
    clock.set(Date.parse('2026-09-24T12:01:00Z')); await service.tick();
    expect(mock.submit).toHaveBeenCalledTimes(beforePause);
    database.close();
  });
});
