import { money } from '../packages/services/src/paper/parallel-paper-utils.js';
import { describe, expect, it, vi } from 'vitest';

import { createMemorySecretStore, createRequestDeadline, AlpacaPaperError } from '../packages/adapters/src/index.js';
import { CHANNEL_SCHEMAS } from '../packages/contracts/src/index.js';
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

describe('paper execution diagnostics and recovery', () => {
  it('reconciles a frozen client before preparation and safely recovers the legacy wrapper pause', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    const calls: string[] = [];
    const client = Object.freeze({ ...mock.client,
      account: async () => { calls.push('account'); return ACCOUNT; },
      activities: async () => { calls.push('activities'); return []; } });
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => { calls.push('preparation'); return prepared; },
      clientFactory: () => client as never, killSwitchEngaged: () => false });
    expect((await service.start('frozen-client', true)).ok).toBe(true);
    clock.set(Date.parse('2026-09-24T12:20:00Z'));
    appendParallelEvent({ experimentId: service.status().experiment!.id, profileId: 'main', kind: 'paused',
      key: 'legacy-wrapper-failure', at: clock.nowMs(), detail: { reason: 'paper_execution_unknown' } }, database);
    calls.length = 0;
    const deadline = createRequestDeadline(() => clock.nowMs());
    await service.tick(deadline); deadline.dispose();
    expect(calls.indexOf('activities')).toBeLessThan(calls.indexOf('preparation'));
    expect(service.status().status).toBe('paused');
    expect(service.summary().reconciliationAttention.blocked).toBe(false);
    expect(mock.submit).not.toHaveBeenCalled();
    expect(service.transition('resumed', 'manual-resume')).toBe(true);
    await service.tick();
    expect(service.status().status).toBe('active'); expect(mock.submit).not.toHaveBeenCalled();
    service.transition('paused', 'owner-pause'); await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'user_action' });
    database.close();
  });

  it('does not pause execution for an optional account-mark read failure', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    let positionsFail = false, positionReads = 0;
    const client = { ...mock.client, positions: async () => {
      if (++positionReads > 2 && positionsFail) throw new AlpacaPaperError('unavailable', 'positions', 503); return [];
    } };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => client as never, killSwitchEngaged: () => false });
    expect((await service.start('optional-mark-failure', true)).ok).toBe(true);
    clock.set(Date.parse('2026-09-24T12:20:00Z')); positionsFail = true;
    await service.tick();
    expect(service.status().status).toBe('active'); expect(mock.submit).not.toHaveBeenCalled();
    expect(service.status().events.some((event) => event.kind === 'research_error' && event.detail['operation'] === 'positions')).toBe(true);
    database.close();
  });

  it('rebuilds a persisted unsubmitted daily plan instead of replaying its quantity', async () => {
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
    expect(mock.submit).toHaveBeenCalledTimes(3);
    expect(mock.submit.mock.calls.every(([order]) => order.client_order_id !== 'persisted-paper-id')).toBe(true);
    expect(service.status().events.some((event) => event.kind === 'plan_superseded')).toBe(true);
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
    expect(service.summary().activity.some((item) => item.kind === 'retry')).toBe(true);
    expect(CHANNEL_SCHEMAS['parallel.paper.status'].response.safeParse(service.summary()).success).toBe(true);
    expect(mock.submit).not.toHaveBeenCalled();
    database.close();
  });

  it('records daily pre-order quotes, deduplicates fee activities and retains later marks', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const ready = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const client = { ...mock.client, positions: async () => (await mock.client.positions()).map((position) => ({ ...position,
      qty: position.symbol === 'BTCUSD' ? money(position.qty).minus('0.002').toString() : position.qty })), activities: async () => [
      ...await mock.client.activities(),
      { id: 'fee-1', activity_type: 'CFEE', qty: '-0.002', symbol: 'BTCUSD',
        net_amount: '0', price: '100', date: '2026-09-24', description: 'must-not-persist-secret' },
    ].filter(() => mock.submit.mock.calls.length > 0) };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => ready, refreshFor: async () => ready,
      clientFactory: () => client as never, killSwitchEngaged: () => false });
    await service.start('fee-evidence', true);
    await service.tick();
    await service.tick();
    const events = service.status().events;
    expect(events.filter((e) => e.kind === 'pre_order_quote')).toHaveLength(3);
    expect(events.filter((e) => e.kind === 'external_fee')).toHaveLength(1);
    expect(service.summary().activity.some((item) => item.kind === 'fee')).toBe(true);
    expect(CHANNEL_SCHEMAS['parallel.paper.status'].response.safeParse(service.summary()).success).toBe(true);
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
    await service.retryReconciliation();
    expect(service.summary().reconciliationAttention.blocked).toBe(false);
    expect(service.transition('resumed', 'resume-without-orders')).toBe(true);
    await service.tick();
    expect(service.summary().state).toBe('paused');
    expect(mock.submit).not.toHaveBeenCalled();
    mock.client.latestCryptoQuotes = mockClient(false, 'filled', TODAY).client.latestCryptoQuotes;
    await service.tick();
    expect(service.summary().state).toBe('paused');
    expect(service.summary().reconciliationAttention.blocked).toBe(false);
    expect(mock.submit).not.toHaveBeenCalled();
    expect(service.transition('resumed', 'manual-resume')).toBe(true);
    await service.tick();
    expect(service.summary().state).toBe('active');
    expect(mock.submit).toHaveBeenCalledTimes(3);
    database.close();
  });

  it('reconciles a broker-accepted lost response after repeated read failures without duplicate submission', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const acceptedSubmit = mock.client.submit;
    let lost = true, readsFail = true, fillsAvailable = false;
    const fills = mock.client.activities;
    const lookup = mock.client.orderByClientId;
    mock.client.submit = vi.fn(async (order) => {
      const result = await acceptedSubmit(order);
      if (lost) { lost = false; throw new AlpacaPaperError('unavailable', 'submit'); }
      return result;
    });
    mock.client.orderByClientId = async (id) => {
      if (readsFail) throw new AlpacaPaperError('unavailable', 'order_lookup', 503);
      return lookup(id);
    };
    mock.client.activities = async () => fillsAvailable ? fills() : [];
    const ready = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => ready, refreshFor: async () => ready, clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    await service.start('lost-accepted-response', true);
    await service.tick();
    for (let attempt = 0; attempt < 3; attempt++) { clock.set(clock.nowMs() + 60_000); await service.tick(); }
    expect(acceptedSubmit).toHaveBeenCalledOnce();
    expect(service.summary().reconciliationAttention).toMatchObject({ blocked: true,
      latestFailure: { operation: 'order_lookup', httpStatus: 503 } });
    readsFail = false; await service.tick();
    expect(service.status().status).toBe('paused');
    expect(service.summary().reconciliationAttention.unresolvedOrders).toHaveLength(1);
    fillsAvailable = true;
    await service.retryReconciliation();
    expect(acceptedSubmit).toHaveBeenCalledOnce();
    expect(service.status().status).toBe('paused');
    expect(service.summary().reconciliationAttention.blocked).toBe(false);
    expect(service.transition('resumed', 'manual-resume')).toBe(true);
    await service.tick(); await service.tick();
    expect(service.status().status).toBe('active');
    const ids = acceptedSubmit.mock.calls.map(([order]) => order.client_order_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
    expect(service.summary().reconciliationAttention.blocked).toBe(false);
    database.close();
  });

  it('operator retry preserves a user pause and late recovery never replays a daily plan', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const ready = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => ready, refreshFor: async () => ready, clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    await service.start('late-recovery', true);
    service.transition('paused', 'owner');
    await service.retryReconciliation();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'user_action' });
    expect(mock.submit).not.toHaveBeenCalled();
    appendParallelEvent({ experimentId: service.status().experiment!.id, profileId: 'main', kind: 'paused',
      key: 'unknown-late', at: clock.nowMs(), detail: { reason: 'paper_execution_unknown' } }, database);
    appendParallelEvent({ experimentId: service.status().experiment!.id, profileId: 'main', kind: 'buy_plan',
      key: 'unsubmitted-late', at: clock.nowMs(), detail: { day: '2026-09-23', orders: [{ clientOrderId: 'old', symbol: 'BTCUSD', side: 'buy', qty: '100' }] } }, database);
    clock.set(Date.parse('2026-09-24T00:20:00Z'));
    await service.tick();
    expect(service.status().status).toBe('paused');
    expect(service.summary().reconciliationAttention.blocked).toBe(false);
    expect(mock.submit).not.toHaveBeenCalled();
    expect(service.transition('resumed', 'manual-resume')).toBe(true);
    await service.tick();
    expect(service.status().status).toBe('active');
    expect(service.status().events.some((event) => event.kind === 'daily_window_missed')).toBe(true);
    expect(service.status().events.some((event) => event.kind === 'slot_finalized')).toBe(true);
    expect(mock.submit).not.toHaveBeenCalled();
    database.close();
  });

  it('does not overwrite an operator pause issued while automatic recovery is preparing', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient();
    const ready = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    let interrupt = false;
    const service: ParallelPaperService = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => ready, refreshFor: async () => {
        if (interrupt) service.transition('paused', 'owner-during-recovery');
        return ready;
      }, clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    await service.start('pause-during-recovery', true);
    appendParallelEvent({ experimentId: service.status().experiment!.id, profileId: 'main', kind: 'paused',
      key: 'unknown-before-preparation', at: clock.nowMs(), detail: { reason: 'paper_execution_unknown' } }, database);
    const deadline = createRequestDeadline(() => clock.nowMs());
    interrupt = true; await service.tick(deadline); deadline.dispose();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'user_action' });
    expect(service.status().events.some((event) => event.kind === 'resumed')).toBe(false);
    expect(mock.submit).not.toHaveBeenCalled();
    database.close();
  });

});
