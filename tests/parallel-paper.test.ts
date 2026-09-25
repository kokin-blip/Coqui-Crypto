import { describe, expect, it, vi } from 'vitest';

import { createMemorySecretStore, AlpacaPaperError } from '../packages/adapters/src/index.js';
import { assetExposureKey, connectionAccountSnapshotV2Hash, FixedClock, instrumentKey, profileConnectionV2, sha256Hex,
  type ConnectionAccountSnapshotV2, type DecisionMarketDataset } from '../packages/core/src/index.js';
import { ParallelPaperService, PARALLEL_INSTRUMENTS, parallelAnchor, parallelDecision } from '../packages/services/src/index.js';
import { appendParallelEvent, listParallelEvents, openDatabase, saveConnectionAccountSnapshotV2, saveProfileConnectionV2,
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

function mockClient(submitFailure = false, fillStatus = 'filled') {
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

describe('parallel paper experiment', () => {
  it('can start Alpaca with a small independent Coinbase comparison book', async () => {
    const { database, clock, secrets } = await setup('47');
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mockClient().client as never, killSwitchEngaged: () => false });
    expect(await service.start('00000000-0000-4000-8000-000000000010', true)).toMatchObject({
      ok: true, experiment: { openingCoquiCash: '47', openingAlpacaCash: '100000' },
    });
    database.close();
  });

  it('keeps the first mix anchor when the rolling data window advances', () => {
    const full = dataset(140);
    const anchor = parallelAnchor(full);
    const shifted = { ...full, dayKeys: full.dayKeys.slice(1),
      closesById: Object.fromEntries(Object.entries(full.closesById).map(([id, closes]) => [id, closes.slice(1)])),
      opensById: Object.fromEntries(Object.entries(full.opensById).map(([id, opens]) => [id, opens.slice(1)])),
    } as DecisionMarketDataset;
    expect(parallelDecision(full, anchor).weights).toEqual(parallelDecision(shifted, anchor).weights);
  });

  it('seeds only the Coinbase dollar value and submits each paper order once', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient();
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    expect(await service.start('00000000-0000-4000-8000-000000000001', false)).toEqual({
      ok: false, code: 'paper_smoke_verification_required',
    });
    const result = await service.start('00000000-0000-4000-8000-000000000001', true);
    expect(result).toMatchObject({ ok: true, experiment: { openingCoquiCash: '1000',
      openingAlpacaCash: '100000', alpacaAccountId: ACCOUNT.id } });
    await service.tick();
    const submitted = mock.submit.mock.calls.length;
    expect(submitted).toBeGreaterThan(0);
    expect(mock.submit.mock.calls.every(([order]) => (order.qty.split('.')[1]?.length ?? 0) <= 4)).toBe(true);
    await service.tick();
    expect(mock.submit).toHaveBeenCalledTimes(submitted);
    expect(service.summary()).toMatchObject({ state: 'active', decisionCount: 1,
      coquiOpeningUsd: '1000', alpacaOpeningUsd: '100000', alpacaOrderCount: submitted });
    expect(service.summary()).toMatchObject({ runtimeState: 'order_pending', lastCheckAtMs: TODAY,
      latestDecision: { day: '2026-09-23', targets: expect.arrayContaining([{ symbol: 'BTCUSD', weightPct: expect.any(String) }]) } });
    expect(service.summary().activity.some((item) => item.kind === 'order' && item.alpacaOrderId !== null)).toBe(true);
    const experimentId = service.status().experiment!.id;
    const recordedOrder = service.status().events.find((event) => event.kind === 'external_order')!;
    appendParallelEvent({ experimentId, profileId: 'main', kind: 'external_fill',
      key: 'fill:paper-activity-test', at: TODAY, detail: { activityId: 'paper-activity-test',
        orderId: recordedOrder.detail['orderId'], symbol: recordedOrder.detail['symbol'],
        quantity: '0.01', price: '100', at: new Date(TODAY).toISOString() } }, database);
    expect(service.summary().alpacaFillCount).toBe(1);
    expect(service.summary().activity[0]).toMatchObject({ kind: 'fill', alpacaOrderId: recordedOrder.detail['orderId'] });
    expect(service.summary().runtimeState).toBe('order_pending');
    for (const order of service.status().events.filter((event) => event.kind === 'external_order')) {
      appendParallelEvent({ experimentId, profileId: 'main', kind: 'external_fill',
        key: `fill:full:${String(order.detail['orderId'])}`, at: TODAY,
        detail: { activityId: `full:${String(order.detail['orderId'])}`,
          orderId: order.detail['orderId'], symbol: order.detail['symbol'],
          quantity: order.detail['filledQty'], price: '100', at: new Date(TODAY).toISOString() } }, database);
    }
    expect(service.summary().runtimeState).toBe('reconciled');
    database.close();
  });

  it('never blindly resubmits an ambiguous paper order', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(true);
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    const result = await service.start('00000000-0000-4000-8000-000000000002', true);
    expect(result.ok).toBe(true);
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'alpaca_unavailable' });
    const experimentId = service.status().experiment!.id;
    expect(listParallelEvents(experimentId, 'main', database).some((event) => event.kind === 'submit_attempt')).toBe(true);
    service.transition('resumed', '00000000-0000-4000-8000-000000000003');
    await service.tick();
    expect(mock.submit).toHaveBeenCalledTimes(1);
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'submission_outcome_unknown' });
    database.close();
  });

  it('does not submit a second order while the first is only partially filled', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'partially_filled');
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    expect((await service.start('00000000-0000-4000-8000-000000000004', true)).ok).toBe(true);
    await service.tick();
    const submitted = mock.submit.mock.calls.length;
    expect(submitted).toBeGreaterThan(0);
    expect(service.summary()).toMatchObject({ state: 'active', alpacaOrderCount: submitted });
    expect(service.summary()).toMatchObject({ runtimeState: 'order_pending' });
    expect(service.summary().activity.some((item) => item.kind === 'order' && item.title.includes('partially filled'))).toBe(true);
    clock.set(Date.parse('2026-09-24T00:16:00Z'));
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'execution_window_missed' });
    expect(service.summary()).toMatchObject({ runtimeState: 'attention' });
    expect(service.summary().activity[0]).toMatchObject({ kind: 'paused', detail: 'execution window missed' });
    await service.tick();
    expect(mock.submit).toHaveBeenCalledTimes(submitted);
    database.close();
  });

  it('shows waiting, explicit no-trade, and an overdue scheduler without inventing orders', async () => {
    const { database, clock, secrets } = await setup();
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mockClient().client as never, killSwitchEngaged: () => false });
    expect((await service.start('00000000-0000-4000-8000-000000000005', true)).ok).toBe(true);
    expect(service.summary()).toMatchObject({ runtimeState: 'awaiting', lastCheckAtMs: null,
      lastDecisionAtMs: null, activity: [] });
    const experimentId = service.status().experiment!.id;
    const record = (kind: string, key: string, detail: Record<string, unknown>) =>
      appendParallelEvent({ experimentId, profileId: 'main', kind, key, at: clock.nowMs(), detail }, database);
    record('decision', 'decision:2026-09-23', { day: '2026-09-23', exposure: 0.5,
      cashWeight: 0.5, mixVolPct: 12, belowTrend: true, weights: {} });
    record('sell_plan', 'sell-plan:2026-09-23', { day: '2026-09-23', count: 0 });
    record('buy_plan', 'buy-plan:2026-09-23', { day: '2026-09-23', count: 0 });
    record('external_complete', 'external-complete:2026-09-23', { day: '2026-09-23' });
    await service.tick();
    expect(service.summary()).toMatchObject({ runtimeState: 'reconciled', alpacaOrderCount: 0,
      latestDecision: { exposurePct: '50.0', cashPct: '50.0', belowTrend: true } });
    expect(service.summary().activity[0]).toMatchObject({ kind: 'no_trade', title: 'No Alpaca order needed' });
    clock.set(TODAY + 240_000);
    expect(service.summary()).toMatchObject({ runtimeState: 'attention', lastCheckAtMs: TODAY });
    database.close();
  });
});
