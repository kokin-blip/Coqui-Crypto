import { describe, expect, it, vi } from 'vitest';

import { createMemorySecretStore, AlpacaPaperError } from '../packages/adapters/src/index.js';
import { assetExposureKey, connectionAccountSnapshotV2Hash, FixedClock, instrumentKey, profileConnectionV2, sha256Hex,
  type ConnectionAccountSnapshotV2, type DecisionMarketDataset } from '../packages/core/src/index.js';
import { ParallelPaperService, PARALLEL_INSTRUMENTS } from '../packages/services/src/index.js';
import { appendParallelEvent, openDatabase, saveConnectionAccountSnapshotV2, saveProfileConnectionV2,
  setSetting } from '../packages/storage/src/index.js';

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
    positions: async () => [],
    orders: async () => [],
    asset: async (symbol: string) => ({ symbol, status: 'active', tradable: true,
      min_order_size: '0.0001', min_trade_increment: '0.0001' }),
    latestCryptoQuotes: async () => ({ quotes: Object.fromEntries(['BTC', 'ETH', 'LTC'].map((symbol) =>
      [`${symbol}/USD`, { bp: 100, ap: 101,
        t: new Date(typeof quoteAtMs === 'function' ? quoteAtMs() : quoteAtMs).toISOString() }])) }),
    activities: async () => [],
    orderByClientId: async (id: string) => {
      const order = orders.get(id);
      if (order === undefined) throw new AlpacaPaperError('not_found');
      return order;
    },
    submit,
    cancel: async () => undefined,
  }, submit };
}

describe('paper execution diagnostics and recovery', () => {
  it('recovers a persisted daily plan interrupted before its intent was written', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient();
    const ready = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => ready, refreshFor: async () => ready,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    await service.start('interrupted-plan', true);
    appendParallelEvent({ experimentId: service.status().experiment!.id, profileId: 'main',
      kind: 'buy_plan', key: 'buy-plan:2026-09-23', at: TODAY,
      detail: { day: '2026-09-23', orders: [{ clientOrderId: 'persisted-paper-id', symbol: 'BTCUSD', side: 'buy', qty: '1' }] } }, database);
    await service.tick();
    await service.tick();
    expect(mock.submit).toHaveBeenCalledOnce();
    expect(mock.submit.mock.calls[0]?.[0]).toMatchObject({ client_order_id: 'persisted-paper-id' });
    database.close();
  });

  it('retains a user pause through repeated transient reconciliation failures', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient();
    const ready = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => ready, refreshFor: async () => ready,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    await service.start('pause-read-failure', true);
    service.transition('paused', 'owner-pause');
    const account = mock.client.account;
    mock.client.account = async () => { throw new AlpacaPaperError('unavailable', 'account', 503); };
    await service.tick();
    mock.client.account = account;
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'user_action' });
    expect(service.status().events.some((event) => event.kind === 'reconciliation_error')).toBe(true);
    expect(mock.submit).not.toHaveBeenCalled();
    database.close();
  });

  it('records daily pre-order quotes, deduplicates fee activities and retains later marks', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const ready = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const client = { ...mock.client, activities: async () => [
      { id: 'fee-1', activity_type: 'CFEE', qty: '-0.002', symbol: 'BTCUSD',
        net_amount: '0', price: '100', date: '2026-09-24', description: 'must-not-persist-secret' },
    ] };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => ready, refreshFor: async () => ready,
      clientFactory: () => client as never, killSwitchEngaged: () => false });
    await service.start('fee-evidence', true);
    await service.tick();
    await service.tick();
    const events = service.status().events;
    expect(events.filter((e) => e.kind === 'pre_order_quote')).toHaveLength(3);
    expect(events.filter((e) => e.kind === 'external_fee')).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('must-not-persist-secret');
    for (const intent of events.filter((e) => e.kind === 'external_intent')) {
      const quoteIndex = events.findIndex((e) => e.kind === 'pre_order_quote' && e.detail['clientOrderId'] === intent.detail['clientOrderId']);
      const attemptIndex = events.findIndex((e) => e.kind === 'submit_attempt' && e.detail['clientOrderId'] === intent.detail['clientOrderId']);
      expect(quoteIndex).toBeLessThan(attemptIndex);
      expect(events[quoteIndex]?.detail).toMatchObject({ bid: '100', ask: '101', costEvidence: 'assumption_not_booked_fee' });
    }
    const marks = events.filter((e) => e.kind === 'account_mark').length;
    clock.set(TODAY + 3_600_000);
    await service.tick();
    expect(service.status().events.filter((e) => e.kind === 'account_mark')).toHaveLength(marks + 1);
    database.close();
  });

  it('recovers stale pre-order quotes without submitting twice or losing daily intents', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', TODAY - 120_000);
    const ready = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => ready, refreshFor: async () => ready,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    await service.start('stale-quotes', true);
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'stale_alpaca_quote' });
    expect(mock.submit).not.toHaveBeenCalled();
    mock.client.latestCryptoQuotes = mockClient(false, 'filled', TODAY).client.latestCryptoQuotes;
    await service.tick();
    await service.tick();
    expect(service.summary().state).toBe('active');
    expect(mock.submit).toHaveBeenCalledTimes(3);
    database.close();
  });

});
