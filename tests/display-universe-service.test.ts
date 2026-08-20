import { describe, expect, it, vi } from 'vitest';

import type { CoinbaseCatalogSource } from '../packages/adapters/src/index.js';
import type { AssetRef } from '../packages/core/src/index.js';
import {
  DisplayUniverseService,
  type DisplayUniverseEventIdSource,
} from '../packages/services/src/index.js';
import {
  listDisplayUniverse,
  openDatabase,
  recordCoinbaseCatalogAssets,
} from '../packages/storage/src/index.js';

const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteAsset: 'USD', coingeckoId: null,
};
const ETH: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' },
  symbol: 'ETH', name: 'Ethereum', baseAsset: 'ETH', quoteAsset: 'USD', coingeckoId: null,
};
const SOL: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'SOL-USD', productType: 'spot' },
  symbol: 'SOL', name: 'Solana', baseAsset: 'SOL', quoteAsset: 'USD', coingeckoId: null,
};

function idSource(...ids: string[]): DisplayUniverseEventIdSource {
  let index = 0;
  return { nextId: () => ids[index++] ?? '99999999-9999-4999-8999-999999999999' };
}

function clock(...values: number[]) {
  let index = 0;
  return { nowMs: () => values[index++] ?? values.at(-1)! };
}

function catalog(assets: readonly AssetRef[] = [BTC, ETH, SOL]): CoinbaseCatalogSource {
  return {
    search: vi.fn(async () => ({ ok: true as const, assets })),
    page: vi.fn(async () => ({ ok: true as const, assets })),
  };
}

describe('display universe service', () => {
  it('searches a bounded Coinbase catalog, records canonical mappings, and freezes output', async () => {
    const database = openDatabase(':memory:');
    const source = catalog([BTC, ETH]);
    const service = new DisplayUniverseService({
      database, clock: clock(100, 110), catalog: source,
      idSource: idSource('11111111-1111-4111-8111-111111111111'),
    });
    const result = await service.search('main', ' eth ', 2);
    expect(result).toEqual({ ok: true, value: {
      profileId: 'main', provider: 'coinbase', query: 'eth',
      requestedAtMs: 100, receivedAtMs: 110, items: [BTC, ETH],
    } });
    expect(source.search).toHaveBeenCalledWith('eth', 2, undefined);
    expect(database.prepare('SELECT COUNT(*) AS count FROM canonical_instruments').get())
      .toEqual({ count: 2 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.items)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.items[0]?.instrument)).toBe(true);
    database.close();
  });

  it('returns a bounded catalog page with explicit continuation and ordered tracked state', async () => {
    const database = openDatabase(':memory:');
    recordCoinbaseCatalogAssets([BTC, ETH], 1, database);
    const serviceForSave = new DisplayUniverseService({
      database, clock: clock(2), catalog: catalog(),
      idSource: idSource('11111111-1111-4111-8111-111111111111'),
    });
    expect(serviceForSave.setTracked('main', [ETH.instrument, BTC.instrument]).ok).toBe(true);
    const source = catalog([BTC, ETH, SOL]);
    const service = new DisplayUniverseService({
      database, clock: clock(10, 11), catalog: source,
      idSource: idSource('22222222-2222-4222-8222-222222222222'),
    });
    const result = await service.view('main', 0, 2);
    expect(result).toMatchObject({ ok: true, value: {
      catalogOffset: 0, catalogLimit: 2, catalogHasMore: true,
      catalog: [BTC, ETH], tracked: [ETH, BTC], researchUniverseMutated: false,
    } });
    expect(source.page).toHaveBeenCalledWith(0, 3, undefined);
    database.close();
  });

  it('replaces only explicit known canonical identities and permits an explicit empty selection', () => {
    const database = openDatabase(':memory:');
    recordCoinbaseCatalogAssets([BTC, ETH], 1, database);
    const service = new DisplayUniverseService({
      database, clock: clock(20, 21), catalog: catalog(),
      idSource: idSource(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ),
    });
    const saved = service.setTracked('main', [ETH.instrument, BTC.instrument]);
    expect(saved).toMatchObject({ ok: true, value: {
      changed: true, tracked: [ETH, BTC], researchUniverseMutated: false,
    } });
    expect(service.setTracked('main', [])).toMatchObject({
      ok: true, value: { changed: true, tracked: [], researchUniverseMutated: false },
    });
    expect(listDisplayUniverse('main', database)).toEqual([]);
    database.close();
  });

  it('rejects duplicates, unknown instruments, extra identity fields, and oversized selections', () => {
    const database = openDatabase(':memory:');
    recordCoinbaseCatalogAssets([BTC], 1, database);
    const service = new DisplayUniverseService({
      database, clock: clock(10, 10, 10), catalog: catalog(),
      idSource: idSource(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ),
    });
    expect(service.setTracked('main', [BTC.instrument, BTC.instrument])).toEqual({
      ok: false, issues: [{ path: ['selection', '1'], code: 'duplicate_instrument' }],
    });
    expect(service.setTracked('main', [{
      venue: 'coinbase', productId: 'BTC-USD', productType: 'spot', extra: true,
    }])).toEqual({
      ok: false, issues: [{ path: ['selection', '0'], code: 'invalid_selection' }],
    });
    expect(service.setTracked('main', [{
      venue: 'coinbase', productId: 'MISSING-USD', productType: 'spot',
    }])).toEqual({
      ok: false, issues: [{ path: ['selection'], code: 'unknown_instrument' }],
    });
    expect(service.setTracked('main', Array.from({ length: 101 }, () => BTC.instrument)))
      .toEqual({ ok: false, issues: [{ path: ['selection'], code: 'invalid_selection' }] });
    expect(listDisplayUniverse('main', database)).toEqual([]);
    database.close();
  });

  it('maps catalog failures/cancellation and rejects malformed source output without diagnostics', async () => {
    const database = openDatabase(':memory:');
    const failedSource: CoinbaseCatalogSource = {
      search: vi.fn(async () => ({ ok: false as const, code: 'rate_limited' as const })),
      page: vi.fn(async () => { throw new Error('raw provider detail'); }),
    };
    const service = new DisplayUniverseService({
      database, clock: clock(1, 1), catalog: failedSource,
      idSource: idSource('11111111-1111-4111-8111-111111111111'),
    });
    expect(await service.search('main', 'btc')).toEqual({
      ok: false, issues: [{ path: [], code: 'catalog_rate_limited' }],
    });
    const controller = new AbortController();
    controller.abort();
    expect(await service.view('main', 0, 10, controller.signal)).toEqual({
      ok: false, issues: [{ path: [], code: 'catalog_cancelled' }],
    });
    const malformed = catalog([{ ...BTC, quoteAsset: 'EUR' as 'USD' }]);
    const invalid = new DisplayUniverseService({
      database, clock: clock(2, 3), catalog: malformed,
      idSource: idSource('22222222-2222-4222-8222-222222222222'),
    });
    expect(await invalid.search('main', 'btc')).toEqual({
      ok: false, issues: [{ path: [], code: 'catalog_invalid_response' }],
    });
    const ignoresCancellation = catalog([BTC]);
    const cancelled = new DisplayUniverseService({
      database, clock: clock(4), catalog: ignoresCancellation,
      idSource: idSource('33333333-3333-4333-8333-333333333333'),
    });
    const ignored = new AbortController();
    ignored.abort();
    expect(await cancelled.search('main', 'btc', 25, ignored.signal)).toEqual({
      ok: false, issues: [{ path: [], code: 'catalog_cancelled' }],
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM canonical_instruments').get())
      .toEqual({ count: 0 });
    database.close();
  });

  it('validates all bounds before clocks, IDs, storage, or provider calls', async () => {
    const database = openDatabase(':memory:');
    const source = catalog();
    const ids = { nextId: vi.fn() };
    const nowMs = vi.fn();
    const service = new DisplayUniverseService({
      database, clock: { nowMs }, catalog: source, idSource: ids,
    });
    expect(await service.search('../bad', 'btc')).toMatchObject({ ok: false });
    expect(await service.search('main', '')).toMatchObject({ ok: false });
    expect(await service.view('main', -1, 10)).toMatchObject({ ok: false });
    expect(await service.view('main', 0, 51)).toMatchObject({ ok: false });
    expect(service.setTracked('main', null)).toMatchObject({ ok: false });
    expect(source.search).not.toHaveBeenCalled();
    expect(source.page).not.toHaveBeenCalled();
    expect(nowMs).not.toHaveBeenCalled();
    expect(ids.nextId).not.toHaveBeenCalled();
    database.close();
  });
});
