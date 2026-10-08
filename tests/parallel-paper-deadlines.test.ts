import { hourlyShadowStatus } from '../packages/services/src/paper/parallel-hourly-shadow.js';
import { restartHourlyStudy } from '../packages/services/src/paper/restart-hourly-study.js';
import { reconcileParallelPaper } from '../packages/services/src/paper/parallel-paper-reconciliation.js';
import { ParallelPaperPass } from '../packages/services/src/paper/parallel-paper-pass.js';
import { money } from '../packages/services/src/paper/parallel-paper-utils.js';
import { createParallelPaperHandlers } from '../apps/desktop/src/main/parallel-paper-handlers.js';
import { describe, expect, it, vi } from 'vitest';

import { createMemorySecretStore, createRequestDeadline, AlpacaPaperError } from '../packages/adapters/src/index.js';
import { CHANNEL_SCHEMAS } from '../packages/contracts/src/index.js';
import { canonicalJson, createStudyInstance, HOURLY_EXECUTION_V1, assetExposureKey, connectionAccountSnapshotV2Hash, FixedClock, instrumentKey, profileConnectionV2, sha256Hex,
  type ConnectionAccountSnapshotV2, type DecisionMarketDataset } from '../packages/core/src/index.js';
import { ParallelPaperService, PARALLEL_INSTRUMENTS } from '../packages/services/src/index.js';
import { appendParallelEvent, openDatabase, saveConnectionAccountSnapshotV2, saveProfileConnectionV2,
  appendHourlyExecutionRecord, appendRemediationEvidence, listRemediationEvidence, registerStudyInstance, createParallelEventReader, listParallelEvents, setSetting } from '../packages/storage/src/index.js';

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

const prepared = () => ({ ok: true as const, dataset: dataset(), datasetHash: sha256Hex('data'),
  latestCompletedStartMs: TODAY - DAY, expectedCompletedStartMs: TODAY - DAY, ruleSnapshotHash: sha256Hex('rules') });

describe('bounded paper passes', () => {
  it.each([false, true])('preserves a newer pause during Resume (new pause: %s)', async (pauseAgain) => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient();
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
    let recovering = false;
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: prepared, refreshFor: async () => {
        if (recovering) { entered.resolve(undefined); await release.promise; }
        return prepared();
      }, clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    try {
      await service.start('resume-race', true);
      const handlers = createParallelPaperHandlers(service);
      await handlers['parallel.paper.pause']!({ commandId: 'original-pause' } as never);
      recovering = true;
      const resume = handlers['parallel.paper.resume']!({ commandId: 'pending-resume' } as never);
      await entered.promise;
      if (pauseAgain) await handlers['parallel.paper.pause']!({ commandId: 'newer-pause' } as never);
      release.resolve(undefined);
      const result = await resume;
      expect(result).toMatchObject(pauseAgain
        ? { ok: false, issues: [{ code: 'paper_resume_blocked' }] }
        : { ok: true, value: { state: 'active' } });
      expect(service.status().status).toBe(pauseAgain ? 'paused' : 'active');
      expect(service.status().events.some(event => event.kind === 'resumed')).toBe(!pauseAgain);
      expect(mock.submit).not.toHaveBeenCalled();
    } finally { release.resolve(undefined); database.close(); }
  });

  it('recovers a paused large journal after slow reconciliation without reserving submission time', async () => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(); let recovering = false;
    const refreshFor = vi.fn(async (_at: number, deadline?: { remainingMs(): number }) => {
      if (recovering) {
        expect(deadline!.remainingMs()).toBeGreaterThan(5_000);
        clock.set(clock.nowMs() + 2_000);
      }
      return prepared();
    });
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: prepared, refreshFor, killSwitchEngaged: () => false,
      clientFactory: () => ({ ...mock.client, activities: async () => {
        if (recovering) clock.set(clock.nowMs() + 17_000);
        return [];
      } }) as never });
    await service.start('paused-large-journal', true);
    const id = service.status().experiment!.id;
    database.exec('BEGIN');
    for (let index = 0; index < 40_000; index++) appendParallelEvent({ experimentId: id, profileId: 'main',
      kind: 'readiness', key: `history-${index}`, at: TODAY, detail: { operation: 'quote', status: 'received' } }, database);
    database.exec('COMMIT');
    expect(service.transition('paused', 'operator-pause')).toBe(true);
    recovering = true;
    const deadline = createRequestDeadline(() => clock.nowMs());
    try { await service.tick(deadline); } finally { deadline.dispose(); }
    expect(service.status().status).toBe('paused');
    expect(service.summary().latestPass).toMatchObject({ outcome: 'completed', phase: 'resume_preflight' });
    expect(service.summary().reconciliationAttention.blocked).toBe(false);
    expect(mock.submit).not.toHaveBeenCalled();
    database.close();
  });
  it.each(['credentials', 'activities', 'preparation', 'pre_submission'])('defers %s exhaustion without submitting and retries safely', async (phase) => {
    const { database, clock, secrets } = await setup();
    const mock = mockClient(false, 'filled', () => clock.nowMs()); let exhaust = false;
    const spend = () => { if (exhaust) { exhaust = false; clock.set(clock.nowMs() + (phase === 'preparation' ? 16_000 : phase === 'pre_submission' ? 26_000 : 31_000)); } };
    const service = new ParallelPaperService({ profileId: 'main', database, clock,
      secrets: { ...secrets, read: async (...args) => { if (phase === 'credentials') spend(); return secrets.read(...args); } },
      preparation: prepared, refreshFor: async () => prepared(),
      clientFactory: () => ({ ...mock.client,
        activities: async () => { if (phase === 'activities' || phase === 'preparation') spend(); return mock.client.activities(); },
        latestCryptoQuotes: async () => { if (phase === 'pre_submission') spend(); return mock.client.latestCryptoQuotes(); } }) as never,
      killSwitchEngaged: () => false });
    await service.start(`budget-${phase}`, true); exhaust = true;
    const deadline = createRequestDeadline(() => clock.nowMs());
    await service.tick(deadline); deadline.dispose();
    expect(service.status().status).toBe('active'); expect(mock.submit).not.toHaveBeenCalled();
    expect(service.summary().latestPass).toMatchObject({ outcome: 'deferred', retryAtMs: TODAY + 60_000 });
    expect(service.summary().reconciliationAttention.blocked).toBe(false);
    const deferred = service.status().events.findLast(e => e.kind === 'pass_deferred');
    expect(deferred?.detail['operation']).not.toBe('unknown');
    if (phase === 'preparation') expect(deferred?.detail).toMatchObject({ operation: 'market_preparation', requiredReservationMs: 15_000 });
    if (phase === 'pre_submission') expect(deferred?.detail).toMatchObject({ operation: 'pre_submission', requiredReservationMs: 5_000 });
    const next = createRequestDeadline(() => clock.nowMs()); await service.tick(next); next.dispose();
    expect(service.status().status).toBe('active'); expect(mock.submit).toHaveBeenCalled();
    expect(service.summary().latestPass?.outcome).toBe('completed');
    expect(CHANNEL_SCHEMAS['parallel.paper.status'].response.safeParse(service.summary()).success).toBe(true);
    database.close();
  });
  it('does not defer an uncertain submission or automatically resume its recovered state', async () => {
    const { database, clock, secrets } = await setup(); const mock = mockClient(false, 'filled', () => clock.nowMs());
    let lost = true;
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: prepared, refreshFor: async () => prepared(), killSwitchEngaged: () => false,
      clientFactory: () => ({ ...mock.client, submit: async (order: Parameters<typeof mock.submit>[0]) => {
        const result = await mock.submit(order); if (lost) { lost = false; throw new AlpacaPaperError('deadline_exceeded'); } return result;
      } }) as never });
    await service.start('lost-response', true); const deadline = createRequestDeadline(() => clock.nowMs());
    await service.tick(deadline); deadline.dispose();
    expect(service.status().status).toBe('paused'); expect(service.summary().lastReason).toBe('submission_outcome_unknown');
    expect(service.status().events.some(e => e.kind === 'pass_deferred')).toBe(false);
    await service.tick(); expect(service.status().status).toBe('paused'); expect(mock.submit).toHaveBeenCalledOnce();
    expect(service.summary().latestPass).toMatchObject({outcome:'completed',phase:'resume_preflight'});
    expect(service.summary().reconciliationAttention.unresolvedOrders).toHaveLength(0);
    database.close();
  });
  it('observes a concurrent user pause before submission', async () => {
    const { database, clock, secrets } = await setup(); const mock = mockClient(false, 'filled', () => clock.nowMs()); let pause = false;
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets,
      preparation: prepared, refreshFor: async () => prepared(), killSwitchEngaged: () => false,
      clientFactory: () => ({ ...mock.client, latestCryptoQuotes: async () => {
        if (pause) { pause = false; appendParallelEvent({ experimentId: service.status().experiment!.id, profileId: 'main', kind: 'paused', key: 'concurrent-pause', at: clock.nowMs(), detail: { reason: 'user_action' } }, database); }
        return mock.client.latestCryptoQuotes();
      } }) as never });
    await service.start('concurrent', true); pause = true; await service.tick();
    expect(service.status().status).toBe('paused'); expect(service.summary().lastReason).toBe('user_action');
    expect(mock.submit).not.toHaveBeenCalled(); database.close();
  });
  it('reconciles paginated fills and fees with 40,000 diagnostic events using one history read', async () => {
    const { database, clock, secrets } = await setup(); const mock = mockClient();
    const service = new ParallelPaperService({ profileId: 'main', database, clock, secrets, preparation: prepared,
      refreshFor: async () => prepared(), clientFactory: () => mock.client as never, killSwitchEngaged: () => false });
    await service.start('large-history', true); const experiment = service.status().experiment!;
    const append = (kind: string, key: string, detail: Record<string, unknown>) => { appendParallelEvent({experimentId:experiment.id,profileId:'main',kind,key,at:clock.nowMs(),detail},database); };
    database.exec('BEGIN');
    for (let index = 0; index < 40_000; index++) append('readiness', `old-${index}`, { operation: 'quote', status: 'received' });
    for (const symbol of ['BTCUSD', 'ETHUSD', 'LTCUSD']) {
      append('external_intent', `intent-${symbol}`, { clientOrderId: symbol, symbol, side: 'buy' });
      append('submit_attempt', `attempt-${symbol}`, { clientOrderId: symbol });
      append('external_order', `order-${symbol}`, { clientOrderId: symbol, orderId: symbol, symbol, side: 'buy', status: 'filled', filledQty: '1' });
    }
    database.exec('COMMIT');
    const originalPrepare = database.prepare.bind(database); let fullReads = 0, parsedRows = 0;
    const prepareSpy = vi.spyOn(database, 'prepare').mockImplementation((sql) => {
      const statement = originalPrepare(sql);
      if (sql.includes('SELECT rowid AS cursor')) {
        const all = statement.all.bind(statement);
        vi.spyOn(statement, 'all').mockImplementation((...args: Parameters<typeof statement.all>) => {
          if ((args[0] as unknown) === 0) fullReads++;
          const rows = all(...args); parsedRows += rows.length; return rows;
        });
      }
      return statement;
    });
    const pass = new ParallelPaperPass('main', database, clock); const events = () => pass.events(experiment.id);
    const activities = ['BTCUSD','ETHUSD','LTCUSD'].map(symbol => ({id:`fill-${symbol}`,activity_type:'FILL',order_id:symbol,symbol,qty:'1',price:'100',transaction_time:new Date(TODAY).toISOString()}));
    const fees = Array.from({length:98}, (_,i) => ({id:`fee-${i}`,activity_type:'CFEE',symbol:'BTCUSD',qty:'-0.00001'}));
    const page = [...activities, ...fees]; const read = vi.fn(async (_after: string, cursor?: string) => cursor ? page.slice(100) : page.slice(0,100));
    const client = { ...mock.client, activities: read, orderByClientId: vi.fn(async (id: string) => ({id,client_order_id:id,symbol:id,side:'buy',status:'filled',filled_qty:'1',filled_avg_price:'100'})) };
    const started = performance.now();
    await reconcileParallelPaper({experiment,client:client as never,events,now:()=>clock.nowMs(),append});
    const first = events();
    await reconcileParallelPaper({experiment,client:client as never,events,now:()=>clock.nowMs(),append});
    const result = events();
    expect(performance.now()-started).toBeLessThan(5_000);
    expect(fullReads).toBe(1); expect(parsedRows).toBe(result.length);
    expect(result.filter(e=>e.kind==='external_fill')).toHaveLength(3);
    expect(result.filter(e=>e.kind==='external_fee')).toHaveLength(98);
    expect(result.filter(e=>e.kind==='external_fill'||e.kind==='external_fee')).toEqual(first.filter(e=>e.kind==='external_fill'||e.kind==='external_fee'));
    expect(client.orderByClientId).toHaveBeenCalledTimes(3); expect(read).toHaveBeenCalledTimes(4);
    append('broker_trade_update','external-update',{executionId:'stream-fill'});
    expect(events().at(-1)?.kind).toBe('broker_trade_update');
    expect(listParallelEvents(experiment.id,'main',database)).toEqual(events());
    prepareSpy.mockRestore(); database.close();
  });
  it('keeps snapshots stable and isolates profiles and experiments', async () => {
    const {database,clock,secrets}=await setup(); const mock=mockClient(); const service=new ParallelPaperService({profileId:'main',database,clock,secrets,
      preparation:prepared,refreshFor:async()=>prepared(),clientFactory:()=>mock.client as never,killSwitchEngaged:()=>false});
    await service.start('reader',true); const id=service.status().experiment!.id, read=createParallelEventReader('main',database), before=read(id);
    appendParallelEvent({experimentId:id,profileId:'main',kind:'paused',key:'pause',at:clock.nowMs(),detail:{reason:'user_action'}},database);
    expect(before.some(e=>e.kind==='paused')).toBe(false);expect(read(id).at(-1)?.kind).toBe('paused');
    expect(createParallelEventReader('other',database)(id)).toEqual([]);expect(read('other')).toEqual([]);expect(read(id).at(-1)?.kind).toBe('paused');database.close();
  });
});

describe('current shadow provenance', () => {
  it.each(['valid', 'changed', 'malformed'])('reports %s registration without rewriting historical failures', async (kind) => {
    const { database, clock, secrets } = await setup(); const mock=mockClient();
    const service=new ParallelPaperService({profileId:'main',database,clock,secrets,preparation:prepared,
      refreshFor:async()=>prepared(),clientFactory:()=>mock.client as never,killSwitchEngaged:()=>false});
    await service.start(`shadow-${kind}`,true);
    const oldStart=Math.floor(TODAY/DAY)*DAY-10*DAY;
    appendHourlyExecutionRecord('main',{kind:'study',key:HOURLY_EXECUTION_V1.id,atMs:oldStart-DAY,
      body:{version:HOURLY_EXECUTION_V1.id,startMs:oldStart,foldEndsMs:[oldStart+30*DAY],holdoutEndMs:oldStart+60*DAY,
        planHash:sha256Hex(canonicalJson(HOURLY_EXECUTION_V1)),sourceHash:sha256Hex('old-code')}},database);
    let instance=restartHourlyStudy({profileId:'main',db:database,nowMs:TODAY,artifactHash:sha256Hex('artifact')});
    if(kind!=='valid') {
      const config=instance.definition.candidateDefinition as Record<string,unknown>;
      instance=createStudyInstance({...instance.definition,
        ...(kind==='changed'?{behaviorHash:sha256Hex('changed-code')} : {}),
        candidateDefinition:{...config,sourceHash:sha256Hex('changed-code')} as never},TODAY+1,sha256Hex('artifact'));
      registerStudyInstance(instance,database);
    }
    appendRemediationEvidence({profileId:'main',namespace:instance.id,kind:'failure',key:'old-mismatch',atMs:TODAY+2,
      body:{reason:'registered_study_source_changed'}},database);
    const before=listRemediationEvidence('main',instance.id,'failure',database);
    expect(hourlyShadowStatus('main',database).lastFailureReason).toBe(kind==='valid'?null:
      kind==='changed'?'registered_study_source_changed':'invalid_candidate_definition');
    expect(listRemediationEvidence('main',instance.id,'failure',database)).toEqual(before);
    if(kind==='valid') {
      appendRemediationEvidence({profileId:'main',namespace:instance.id,kind:'failure',key:'fresh-read-error',atMs:TODAY+3,
        body:{reason:'stale_alpaca_quote'}},database);
      expect(hourlyShadowStatus('main',database).lastFailureReason).toBe('stale_alpaca_quote');
    }
    database.close();
  });
});
