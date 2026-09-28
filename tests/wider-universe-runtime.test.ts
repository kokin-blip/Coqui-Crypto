import { describe, expect, it, vi } from 'vitest';
import { createWiderUniverseRuntime } from '../apps/desktop/src/main/wider-universe-runtime.js';
import { createBreakoutRuntime } from '../apps/desktop/src/main/breakout-runtime.js';
import { createRangeRotationRuntime } from '../apps/desktop/src/main/range-rotation-runtime.js';
import { createMarketSelectorRuntime } from '../apps/desktop/src/main/market-selector-runtime.js';
import { createAlpacaPaperClient, createMemorySecretStore, parseAlpacaUniverseAssets,
  parseAlpacaUniverseLiquidity } from '../packages/adapters/src/index.js';
import { universeHash, sha256Hex, UNIVERSE_DAY, profileConnectionV2, connectionAccountSnapshotV2Hash } from '../packages/core/src/index.js';
import { appendUniverseRecord, appendParallelEvent, listBreakoutHourlyBars, listBreakoutRecords,
  appendMarketSelectorRecord, listRangeRotationRecords, listMarketSelectorRecords, listUniverseRecords, openDatabase, saveParallelExperiment, setSetting,
  saveProfileConnectionV2, saveConnectionAccountSnapshotV2, loadUniverseResearchFrames } from '../packages/storage/src/index.js';
import { universeEvidence, universeSlot, UNIVERSE_NOW, UNIVERSE_ANCHOR } from './fixtures/wider-universe.js';

describe('wider universe storage and adapters', () => {
  it('stores immutable, profile-scoped, content-verified evidence with conflicting retry rejection', () => {
    const db = openDatabase(':memory:');
    const record = { kind: 'policy' as const, key: 'v1', atMs: 1, body: { value: 2 } };
    expect(appendUniverseRecord('main', record, db)).toBe(true);
    expect(appendUniverseRecord('main', record, db)).toBe(false);
    expect(listUniverseRecords('other', 'policy', db)).toEqual([]);
    expect(() => appendUniverseRecord('main', { ...record, body: { value: 3 } }, db)).toThrow('conflict');
    expect(() => db.exec('DELETE FROM wider_universe_records_v1')).toThrow('immutable');
    expect(() => db.exec("UPDATE wider_universe_records_v1 SET body_json='{}'")).toThrow('immutable');
    db.exec('DROP TRIGGER wider_universe_no_update');
    db.exec("UPDATE wider_universe_records_v1 SET body_json='{}'");
    expect(() => listUniverseRecords('main', 'policy', db)).toThrow('integrity');
    db.close();
  });
  it('reads explicit-symbol catalogs/books from paper and data hosts, never submits', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).includes('/assets?') ? [universeEvidence().asset] : {}));
    const client = createAlpacaPaperClient({ keyId: 'test', secretKey: 'secret' }, fetcher);
    expect((await client.cryptoAssets())[0]!.symbol).toBe('BTC/USD');
    await client.latestCryptoQuotes(['SOL/USD', 'BTC/USD']);
    await client.latestCryptoOrderbooks(['SOL/USD']);
    expect(fetcher.mock.calls.map(([u]) => String(u))).toEqual([
      'https://paper-api.alpaca.markets/v2/assets?asset_class=crypto',
      'https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols=BTC%2FUSD%2CSOL%2FUSD',
      'https://data.alpaca.markets/v1beta3/crypto/us/latest/orderbooks?symbols=SOL%2FUSD' ]);
    expect(() => client.latestCryptoQuotes(['BTC/USD?secret'])).toThrow();
    expect(() => parseAlpacaUniverseAssets([universeEvidence().asset, universeEvidence().asset])).toThrow();
    expect(() => parseAlpacaUniverseLiquidity({}, {}, 'BTC/USD', UNIVERSE_NOW)).toThrow();
  });
});

describe('credential-contained shadow collector', () => {
  it('waits for prior-day evidence, collects four assets, persists shadow only, and resumes without duplicates', async () => {
    const db = openDatabase(':memory:'), secrets = createMemorySecretStore();
    let now = UNIVERSE_NOW - UNIVERSE_DAY;
    const bases = ['BTC', 'ETH', 'LTC', 'SOL'];
    const evidence = (base: string) => universeEvidence(base, now);
    await secrets.write('alpaca-paper-credentials', JSON.stringify({ keyId: 'sentinel-key', secretKey: 'sentinel-secret' }), 'main');
    setSetting('alpaca.paper.account.id', 'account', db);
    const connection = profileConnectionV2('main', 'coinbase', universeHash('key'), now);
    saveProfileConnectionV2(connection, db);
    const material = { schemaVersion: 2 as const, profileId: 'main', connectionId: connection.id, provider: 'coinbase' as const,
      asOfMs: now, balances: [], cashUsd: '100000', buyingPowerUsd: '100000', pendingOrderIds: [],
      permissions: { accountRead: true, marketRead: true, orderRead: true, trade: false as const },
      rulesHash: null, feeEvidenceHash: null, health: 'healthy' as const, failureReason: null, complete: true,
      provenance: { source: 'coinbase' as const, requestedAtMs: now, receivedAtMs: now } };
    const snapshotHash = connectionAccountSnapshotV2Hash({ ...material, id: '', contentHash: '' });
    const snapshotId = sha256Hex(`connection-account-snapshot-v2:${snapshotHash}`);
    saveConnectionAccountSnapshotV2({ ...material, id: snapshotId, contentHash: snapshotHash }, db);
    saveParallelExperiment({ id: universeHash('experiment'), profileId: 'main', sourceConnectionSnapshotId: snapshotId,
      openingCoquiCash: '100000', openingAlpacaCash: '100000', openingAlpacaEquity: '100000',
      alpacaAccountId: 'account', anchor: UNIVERSE_ANCHOR, startedAt: now, configVersion: 'baseline' }, db);
    appendParallelEvent({ experimentId: universeHash('experiment'), profileId: 'main', kind: 'started', key: 'start', at: now, detail: {} }, db);
    const account = { id: 'account', currency: 'USD', status: 'PAPER_ONLY', cash: '100000', equity: '100000', trading_blocked: false, account_blocked: false };
    const submit = vi.fn(() => { throw new Error('shadow must never submit'); });
    const quoteResponse = () => ({ quotes: Object.fromEntries(bases.map((b) => [`${b}/USD`,
      { bp: 99.9, ap: 100.1, t: new Date(now).toISOString() }])) });
    const bookResponse = () => ({ orderbooks: Object.fromEntries(bases.map((b) => [`${b}/USD`,
      { b: [{ p: 99.9, s: 100000 }], a: [{ p: 100.1, s: 100000 }], t: new Date(now).toISOString() }])) });
    const client = { account: async () => account, positions: async () => [],
      cryptoAssets: async () => bases.map((b) => evidence(b).asset),
      asset: async (symbol: string) => evidence(symbol.split('/')[0]!).asset,
      latestCryptoQuotes: async () => quoteResponse(), latestCryptoOrderbooks: async () => bookResponse(), submit };
    const authenticated = { destroy: vi.fn(), getJson: async (url: string) => {
      const u = new URL(url), productId = u.searchParams.get('product_id') ?? u.searchParams.get('product_ids') ?? u.pathname.split('/').at(-1)!;
      const e = evidence(productId.split('-')[0]!);
      const book = { product_id: productId, time: new Date(now).toISOString(), bids: e.coinbase!.bids, asks: e.coinbase!.asks };
      const data = u.pathname.endsWith('best_bid_ask') ? { pricebooks: [book] }
        : u.pathname.endsWith('product_book') ? { pricebook: book }
          : { product_id: productId, product_type: 'SPOT', status: 'online', trading_disabled: false,
            cancel_only: false, limit_only: false, post_only: false, base_increment: '0.000000001', quote_increment: '0.01', quote_min_size: '1',
            base_min_size: '0.000000001', auction_mode: false, is_disabled: false };
      return { ok: true, status: 200, data };
    } };
    const http = { getJson: async () => ({ ok: true, status: 200, data: bases.map((b) => ({ id: `${b}-USD`,
      base_currency: b, quote_currency: 'USD', status: 'online', trading_disabled: false, cancel_only: false,
      limit_only: false, post_only: false, base_increment: '0.000000001', quote_increment: '0.01', min_market_funds: '1' })) }) };
    const dependencies = { profileId: 'main', database: db, clock: { nowMs: () => now }, http: http as never, secrets,
      clientFactory: (() => client) as never, sourceContentHash: universeHash('fixture'), onUnexpectedError: vi.fn(),
      candleSource: { authenticatedClient: async () => authenticated,
        dailyBars: async (instrument: { productId: string }) => ({ ok: true, bars: evidence(instrument.productId.split('-')[0]!).bars }) } as never };
    await createWiderUniverseRuntime(dependencies).refresh();
    expect(listUniverseRecords('main', 'study', db)).toHaveLength(1);
    expect(listUniverseRecords('main', 'frame', db)).toHaveLength(0);
    now = UNIVERSE_NOW;
    await createWiderUniverseRuntime(dependencies).refresh();
    expect(listUniverseRecords('main', 'frame', db)).toHaveLength(1);
    expect(loadUniverseResearchFrames('main', db, now + 1)).toHaveLength(1);
    const shadows = listUniverseRecords('main', 'shadow', db);
    expect(shadows).toHaveLength(1);
    expect(shadows[0]!.body).toMatchObject({ mode: 'shadow', executionEnabled: false,
      eligibleIds: expect.arrayContaining(['coinbase|spot|SOL-USD']) });
    await createWiderUniverseRuntime(dependencies).refresh();
    expect(listUniverseRecords('main', 'shadow', db)).toHaveLength(1);
    expect(submit).not.toHaveBeenCalled();
    expect(JSON.stringify(shadows)).not.toContain('sentinel');
    now += 4 * 3_600_000;
    await createWiderUniverseRuntime(dependencies).refresh();
    const hourly = { ...dependencies, candleSource: { researchHourlyWindow: async (
      instrument: { productId: string }, fromMs: number, toMs: number) => ({ ok: true as const,
      source: 'public' as const, bars: Array.from({ length: (toMs - fromMs) / 3_600_000 }, (_, i) => ({
        productId: instrument.productId, interval: '1h' as const,
        startTimeMs: fromMs + i * 3_600_000, endTimeMs: fromMs + (i + 1) * 3_600_000,
        open: '100', high: '100', low: '100', close: '100', volume: '10',
        retrievedAtMs: now, isComplete: true as const })) }) } as never };
    await createBreakoutRuntime(hourly).refresh();
    expect(listBreakoutRecords('main', 'study', db)).toHaveLength(1);
    expect(listBreakoutRecords('main', 'shadow', db)).toHaveLength(1);
    expect(listBreakoutHourlyBars('main', 'coinbase|spot|BTC-USD', now - 720 * 3_600_000,
      now, now, db).length).toBeGreaterThan(0);
    await createBreakoutRuntime(hourly).refresh();
    expect(listBreakoutRecords('main', 'shadow', db)).toHaveLength(1);
    const range = createRangeRotationRuntime({ profileId: 'main', database: db,
      clock: { nowMs: () => now }, sourceContentHash: universeHash('fixture'),
      onUnexpectedError: vi.fn() });
    await range.refresh();
    await createRangeRotationRuntime({ profileId: 'main', database: db,
      clock: { nowMs: () => now }, sourceContentHash: universeHash('fixture'),
      onUnexpectedError: vi.fn() }).refresh();
    expect(listRangeRotationRecords('main', 'study', db)).toHaveLength(1);
    expect(listRangeRotationRecords('main', 'shadow', db)).toHaveLength(1);
    expect(listRangeRotationRecords('main', 'shadow', db)[0]!.body).toMatchObject({
      executionEnabled: false, portfolio: { cash: '100000' } });
    const selector = createMarketSelectorRuntime({ profileId: 'main', database: db,
      clock: { nowMs: () => now }, sourceContentHash: universeHash('fixture'),
      onUnexpectedError: vi.fn() });
    await selector.refresh();
    await createMarketSelectorRuntime({ profileId: 'main', database: db,
      clock: { nowMs: () => now }, sourceContentHash: universeHash('fixture'),
      onUnexpectedError: vi.fn() }).refresh();
    expect(listMarketSelectorRecords('main', 'study', db)).toHaveLength(1);
    expect(listMarketSelectorRecords('main', 'shadow', db)).toHaveLength(1);
    expect(listMarketSelectorRecords('main', 'shadow', db)[0]!.body).toMatchObject({
      selected: 'trendvol', executionEnabled: false, immediateFillAssumption: true });
    expect(submit).not.toHaveBeenCalled();
    const firstSelector = listMarketSelectorRecords('main', 'shadow', db)[0]!.body as
      { portfolio: { cash: string; quantities: Record<string, string> }; slotMs: number };
    const at8 = now + 4 * 3_600_000, at12 = now + 8 * 3_600_000;
    appendMarketSelectorRecord('main', { kind: 'shadow', key: String(Math.floor(at8 / 14_400_000) * 14_400_000),
      atMs: at8, body: { ...firstSelector, slotMs: Math.floor(at8 / 14_400_000) * 14_400_000,
        pending: [{ id: 'virtual-pending', assetId: 'coinbase|spot|BTC-USD', side: 'buy',
          quantity: '1', cumulativeFilled: '0.4', modeledPrice: '100', feeRate: '0.0025' }] } }, db);
    appendUniverseRecord('main', { kind: 'frame',
      key: String(Math.floor(at12 / 14_400_000) * 14_400_000), atMs: at12,
      body: universeSlot(bases, at12) }, db);
    now = at12;
    await selector.refresh();
    const pendingSlot = listMarketSelectorRecords('main', 'shadow', db).at(-1)!.body as
      { portfolio: unknown; planning: unknown; target: unknown };
    expect(pendingSlot.planning).toMatchObject({ status: 'pending_virtual_reconciliation',
      pendingIds: ['virtual-pending'] });
    expect(pendingSlot.portfolio).toEqual(firstSelector.portfolio);
    expect(pendingSlot.target).toBeDefined();
    const recordedFrame = listUniverseRecords('main', 'frame', db)[0]!.body as { catalogHash: string };
    appendUniverseRecord('main', { kind: 'frame', key: 'tampered-reference', atMs: now,
      body: { ...recordedFrame, catalogHash: universeHash('missing') } }, db);
    expect(() => loadUniverseResearchFrames('main', db, now + 1)).toThrow('catalog_reference_missing');
    db.close();
  });
});
