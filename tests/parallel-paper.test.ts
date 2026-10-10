import { money } from '../packages/services/src/paper/parallel-paper-utils.js';
import { describe, expect, it, vi } from 'vitest';

import { createMemorySecretStore, AlpacaPaperError } from '../packages/adapters/src/index.js';
import { assetExposureKey, connectionAccountSnapshotV2Hash, FixedClock, instrumentKey, profileConnectionV2, sha256Hex,
  type ConnectionAccountSnapshotV2, type DecisionMarketDataset } from '../packages/core/src/index.js';
import { ParallelPaperService, PARALLEL_INSTRUMENTS, parallelAnchor, parallelDecision,
  type MlSignalSnapshot, type PaperDecisionPreparation } from '../packages/services/src/index.js';
import { appendParallelEvent, listParallelEvents, openDatabase, saveConnectionAccountSnapshotV2, saveProfileConnectionV2,
  appendHourlyExecutionRecord, listHourlyExecutionRecords, listStudyInstances, setSetting } from '../packages/storage/src/index.js';
import { restartHourlyStudy } from '../packages/services/src/paper/restart-hourly-study.js';
import { hourlyShadowStatus } from '../packages/services/src/paper/parallel-hourly-shadow.js';
import { canonicalJson, HOURLY_EXECUTION_V1 } from '../packages/core/src/index.js';

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

describe('parallel paper experiment', () => {
  it('captures only its own attempted executions once and cannot resume from an unvalidated net-position update', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient();
    const ready: PaperDecisionPreparation = { ok: true, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({profileId:'main',database,clock,secrets,preparation:()=>ready,
      refreshFor:async()=>ready,clientFactory:()=>mock.client as never,killSwitchEngaged:()=>false});
    await service.start('stream-evidence',true); await service.tick();
    const current = service.status(), order = current.events.find((event)=>event.kind==='external_order')!;
    const update = { executionId:'exec-1',orderId:String(order.detail['orderId']),clientOrderId:String(order.detail['clientOrderId']),
      symbol:String(order.detail['symbol']),side:'buy' as const,at:new Date(TODAY).toISOString(),
      quantity:String(order.detail['filledQty']),filledQty:String(order.detail['filledQty']),price:'100',positionQty:'0.01' };
    service.recordTradeUpdate('wrong-experiment',update);
    service.recordTradeUpdate(current.experiment!.id,{...update,clientOrderId:'foreign'});
    expect(service.status().events.filter((event)=>event.kind==='broker_trade_update')).toHaveLength(0);
    service.recordTradeUpdate(current.experiment!.id,update); service.recordTradeUpdate(current.experiment!.id,update);
    expect(service.status().events.filter((event)=>event.kind==='broker_trade_update')).toHaveLength(1);
    mock.client.positions = async()=>[{symbol:update.symbol,qty:'0.01',market_value:'1'}];
    await service.retryReconciliation();
    expect(service.summary().reconciliationAttention.blocked).toBe(true);
    expect(service.summary().brokerEvidence).toMatchObject({positionStatus:'unreconciled',feeCoverage:'unconfirmed',capturedExecutionCount:1});
    expect(mock.submit).toHaveBeenCalledTimes(3);
    database.close();
  });

  it('starts a prospective hourly study in a fresh namespace without reusing legacy observations', async () => {
    const { database, clock, secrets } = await setup(); const mock=mockClient();
    const ready: PaperDecisionPreparation={ok:true,dataset:dataset(),datasetHash:sha256Hex('data'),
      latestCompletedStartMs:TODAY-DAY,expectedCompletedStartMs:TODAY-DAY,ruleSnapshotHash:sha256Hex('rules')};
    const service=new ParallelPaperService({profileId:'main',database,clock,secrets,preparation:()=>ready,
      refreshFor:async()=>ready,clientFactory:()=>mock.client as never,killSwitchEngaged:()=>false});
    await service.start('restart-hourly',true);
    const oldStart=Math.floor(TODAY/DAY)*DAY-10*DAY;
    appendHourlyExecutionRecord('main',{kind:'study',key:HOURLY_EXECUTION_V1.id,atMs:oldStart-DAY,
      body:{version:HOURLY_EXECUTION_V1.id,startMs:oldStart,foldEndsMs:[oldStart+30*DAY,oldStart+60*DAY,oldStart+90*DAY],
        holdoutEndMs:oldStart+120*DAY,planHash:sha256Hex(canonicalJson(HOURLY_EXECUTION_V1)),sourceHash:sha256Hex('old-code')}},database);
    appendHourlyExecutionRecord('main',{kind:'observation',key:'old',atMs:oldStart,body:{}},database);
    const instance=restartHourlyStudy({profileId:'main',db:database,nowMs:TODAY,artifactHash:sha256Hex('artifact')});
    expect(instance.definition.startMs).toBe(Math.floor(TODAY/DAY)*DAY+DAY);
    expect(instance.definition.holdoutEndMs-instance.definition.startMs).toBe(120*DAY);
    expect(listHourlyExecutionRecords('main','observation',database)).toHaveLength(1);
    expect(hourlyShadowStatus('main',database)).toMatchObject({startMs:instance.definition.startMs,observationCount:0,lastFailureReason:null});
    expect(restartHourlyStudy({profileId:'main',db:database,nowMs:TODAY+1000,artifactHash:sha256Hex('artifact')})).toEqual(instance);
    expect(listStudyInstances('main',HOURLY_EXECUTION_V1.id,database)).toHaveLength(1);
    database.close();
  });
  it('repairs a market-data pause but requires manual resume after the current bar is ready', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient();
    const ready: PaperDecisionPreparation = { ok: true, dataset: dataset(),
      datasetHash: sha256Hex('data'), latestCompletedStartMs: TODAY - DAY,
      expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    let preparation: PaperDecisionPreparation = ready;
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => preparation, refreshFor: async () => ready,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    expect((await service.start('market-recovery-test', true)).ok).toBe(true);
    preparation = { ok: false, code: 'market_fetch_failed' };
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'market_fetch_failed' });
    expect(mock.submit).not.toHaveBeenCalled();

    preparation = { ...ready, dataset: dataset(121, '2026-09-22') };
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'market_fetch_failed' });
    preparation = ready;
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', reconciliationAttention: { blocked: false } });
    expect(mock.submit).not.toHaveBeenCalled();
    expect(service.transition('resumed', 'manual-resume')).toBe(true);
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'active', decisionCount: 1 });
    expect(mock.submit).toHaveBeenCalled();
    service.transition('paused', 'manual-pause-test');
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'user_action' });
    database.close();
  });

  it('prepares manual resume after credential access returns without overriding a user pause', async () => {
    const { database, clock, secrets } = await setup();
    const prepared: PaperDecisionPreparation = { ok: true, dataset: dataset(),
      datasetHash: sha256Hex('data'), latestCompletedStartMs: TODAY - DAY,
      expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') };
    let failRead = false;
    const store = { ...secrets, read: async (...args: Parameters<typeof secrets.read>) => {
      if (failRead) { failRead = false; return { ok: false as const, code: 'unavailable' as const,
        message: 'Secure credential storage is unavailable.' }; }
      return secrets.read(...args);
    } };
    const mock = mockClient();
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets: store,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    expect((await service.start('credential-recovery-test', true)).ok).toBe(true);
    failRead = true;
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'secret_store_unavailable' });
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', reconciliationAttention: { blocked: false } });
    expect(mock.submit).not.toHaveBeenCalled();
    expect(service.transition('resumed', 'manual-resume')).toBe(true);
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'active', decisionCount: 1 });
    service.transition('paused', 'manual-pause-test');
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'user_action' });
    database.close();
  });

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
    expect(service.summary().filterSummary).toMatchObject({ observedDecisions: 1,
      negativeMomentumDays: expect.any(Number), assetVolScaledDays: expect.any(Number),
      portfolioVolScaledDays: expect.any(Number), trendCapDays: expect.any(Number) });
    expect(service.summary().latestDecision?.filters).toMatchObject({
      negativeMomentumAssets: expect.any(Number), assetVolScaledAssets: expect.any(Number) });
    expect(service.summary()).toMatchObject({ runtimeState: 'reconciled', lastCheckAtMs: TODAY,
      latestDecision: { day: '2026-09-23', targets: expect.arrayContaining([{ symbol: 'BTCUSD', weightPct: expect.any(String) }]) } });
    expect(service.summary().activity.some((item) => item.kind === 'order' && item.alpacaOrderId !== null)).toBe(true);
    expect(service.summary().alpacaFillCount).toBe(submitted);
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
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'submission_outcome_unknown' });
    const experimentId = service.status().experiment!.id;
    expect(listParallelEvents(experimentId, 'main', database).some((event) => event.kind === 'submit_attempt')).toBe(true);
    await service.tick();
    expect(mock.submit).toHaveBeenCalledTimes(1);
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'submission_outcome_unknown' });
    database.close();
  });

  it('repairs an Alpaca read outage without automatically enabling trading', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient();
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    let unavailable = true;
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => ({ ...mock.client, account: async () => {
        if (unavailable) throw new AlpacaPaperError('unavailable', 'account', 503);
        return ACCOUNT;
      } }) as never, killSwitchEngaged: () => false });
    unavailable = false;
    expect((await service.start('alpaca-read-recovery', true)).ok).toBe(true);
    unavailable = true;
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', lastReason: 'alpaca_unavailable' });
    expect(service.status().events.find((event) => event.kind === 'paused')?.detail).toMatchObject({
      reason: 'alpaca_unavailable', operation: 'account', httpStatus: 503 });
    expect(service.summary().activity[0]?.detail).toContain('Alpaca account · HTTP 503');
    unavailable = false;
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'paused', reconciliationAttention: { blocked: false } });
    expect(mock.submit).not.toHaveBeenCalled();
    expect(service.status().events.some((event) => event.kind === 'resumed')).toBe(false);
    expect(service.transition('resumed', 'manual-resume')).toBe(true);
    await service.tick();
    expect(service.summary()).toMatchObject({ state: 'active', decisionCount: 1 });
    expect(service.status().events.some((event) => event.kind === 'resumed' &&
      event.detail['reason'] === 'user_action')).toBe(true);
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
    const restarted = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mockClient().client as never, killSwitchEngaged: () => false });
    expect(restarted.summary()).toMatchObject({ runtimeState: 'attention', lastCheckAtMs: TODAY });
    database.close();
  });

  it('records a late daily decision and can place separate intraday paper rebalances', async () => {
    const { database, clock, secrets } = await setup();
    const firstSlot = Date.parse('2026-09-24T08:01:00Z');
    clock.set(firstSlot);
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    expect((await service.start('late-intraday', true)).ok).toBe(true);
    await service.tick();
    expect(service.summary().decisionCount).toBe(1);
    expect(service.status().events.some((event) => event.kind === 'daily_window_missed')).toBe(true);
    const firstOrders = mock.submit.mock.calls.length;
    expect(firstOrders).toBeGreaterThan(0);
    const check = service.status().events.find((event) => event.kind === 'intraday_check');
    expect(check?.detail['quotes']).toMatchObject({ BTCUSD: { bid: '100', ask: '101' } });
    expect(check?.detail['targetWeights']).toBeTruthy();
    const plan = service.status().events.find((event) => event.kind === 'intraday_plan' &&
      event.detail['stage'] === 'buy');
    expect(plan?.detail['diagnostics']).toEqual(expect.arrayContaining([expect.objectContaining({
      symbol: 'BTCUSD', expectedEntryCostPct: '0.748', shadowCostScreen: 'skip',
    })]));
    await service.tick();
    expect(mock.submit).toHaveBeenCalledTimes(firstOrders);
    clock.set(Date.parse('2026-09-24T12:01:00Z'));
    mock.client.latestCryptoQuotes = async () => ({ quotes: Object.fromEntries(['BTC', 'ETH', 'LTC'].map((symbol) =>
      [`${symbol}/USD`, { bp: 200, ap: 201, t: new Date(clock.nowMs()).toISOString() }])) });
    await service.tick();
    expect(mock.submit.mock.calls.length).toBeGreaterThan(firstOrders);
    expect(service.status().events.filter((event) => event.kind === 'intraday_complete')).toHaveLength(2);
    database.close();
  });

  it('does not trade an intraday slot using stale Alpaca quotes', async () => {
    const { database, clock, secrets } = await setup();
    clock.set(Date.parse('2026-09-24T08:01:00Z'));
    const mock = mockClient(false, 'filled', TODAY);
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    expect((await service.start('stale-intraday', true)).ok).toBe(true);
    await service.tick();
    expect(mock.submit).not.toHaveBeenCalled();
    expect(service.status().events.some((event) => event.kind === 'intraday_skipped' &&
      event.detail['reason'] === 'stale_alpaca_quote')).toBe(true);
    database.close();
  });

  it('does not open a later intraday slot while an earlier paper order is partial', async () => {
    const { database, clock, secrets } = await setup();
    clock.set(Date.parse('2026-09-24T08:01:00Z'));
    const mock = mockClient(false, 'partially_filled', () => clock.nowMs());
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    expect((await service.start('partial-intraday', true)).ok).toBe(true);
    await service.tick();
    const firstOrders = mock.submit.mock.calls.length;
    expect(firstOrders).toBeGreaterThan(0);
    expect(service.summary().runtimeState).toBe('order_pending');
    clock.set(Date.parse('2026-09-24T12:01:00Z'));
    await service.tick();
    expect(mock.submit).toHaveBeenCalledTimes(firstOrders);
    expect(service.status().events.some((event) => event.kind === 'intraday_check' &&
      event.detail['slot'] === '2026-09-24T12')).toBe(false);
    database.close();
  });

  it('records an intraday no-trade when the daily target already matches holdings', async () => {
    const { database, clock, secrets } = await setup();
    clock.set(Date.parse('2026-09-24T08:01:00Z'));
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    expect((await service.start('intraday-no-trade', true)).ok).toBe(true);
    appendParallelEvent({ experimentId: service.status().experiment!.id, profileId: 'main',
      kind: 'decision', key: 'decision:2026-09-23', at: clock.nowMs(),
      detail: { day: '2026-09-23', weights: {}, exposure: 0, cashWeight: 1,
        mixVolPct: 10, belowTrend: false } }, database);
    await service.tick();
    expect(mock.submit).not.toHaveBeenCalled();
    expect(service.summary().activity.some((item) => item.title === 'No intraday order needed')).toBe(true);
    expect(service.status().events.find((event) => event.kind === 'intraday_complete')?.detail['orderCount']).toBe(0);
    database.close();
  });

  it('keeps even a qualified ML proposal in shadow and routes unchanged TrendVol targets', async () => {
    const { database, clock, secrets } = await setup();
    clock.set(Date.parse('2026-09-24T08:01:00Z'));
    const mock = mockClient(false, 'filled', () => clock.nowMs());
    const prepared = { ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
      latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY,
      ruleSnapshotHash: sha256Hex('rules') };
    const signal: MlSignalSnapshot = { version: 'trendvol-ml-ridge-v1', datasetHash: sha256Hex('hourly'),
      modelHash: sha256Hex('model'), gate: 'qualified', reason: 'qualified',
      predictedAtMs: Date.parse('2026-09-24T08:00:00Z'), prediction: [0.2, -0.2, 0.01],
      proposedWeights: null, baselineWeights: null, expectedNetImprovement: null, evidence: null };
    const dependencies = { profileId: 'main', database, clock, secrets,
      preparation: () => prepared, refreshFor: async () => prepared,
      clientFactory: () => mock.client as never, killSwitchEngaged: () => false,
      mlSignal: () => signal };
    const service = new ParallelPaperService(dependencies);
    expect((await service.start('ml-paper-target', true)).ok).toBe(true);
    await service.tick();
    const target = service.status().events.find((event) => event.kind === 'ml_target');
    expect(target?.detail['applied']).toBe(false);
    expect(target?.detail['combinedWeights']).toEqual(target?.detail['baselineWeights']);
    expect(service.summary().activity.some((item) => item.kind === 'ml')).toBe(true);
    const count = mock.submit.mock.calls.length;
    const restarted = new ParallelPaperService(dependencies);
    await restarted.tick();
    expect(restarted.status().status).toBe('paused');
    expect(restarted.status().events.some(e=>e.kind==='paused' && e.detail['reason']==='runtime_restart')).toBe(true);
    expect(restarted.transition('resumed','manual-restart-resume')).toBe(true);
    expect(mock.submit).toHaveBeenCalledTimes(count);
    expect(service.status().events.filter((event) => event.kind === 'ml_target')).toHaveLength(1);
    clock.set(Date.parse('2026-09-24T12:02:00Z'));
    const unavailable = new ParallelPaperService({ ...dependencies, mlSignal: () => { throw new Error('model_unavailable'); } });
    await unavailable.tick();
    expect(unavailable.status().status).toBe('paused');
    expect(unavailable.transition('resumed','manual-second-restart-resume')).toBe(true);
    await unavailable.tick();
    expect(service.status().status).toBe('active');
    expect(service.status().events.filter((event) => event.kind === 'ml_target')).toHaveLength(2);
    expect(service.status().events.at(-1)?.kind).not.toBe('paused');
    database.close();
  });
});
