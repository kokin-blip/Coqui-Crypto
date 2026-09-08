import { describe, expect, it } from 'vitest';

import {
  assetExposureKey,
  buildUnifiedPortfolioSnapshotV2,
  connectionAccountSnapshotV2Hash,
  profileConnectionV2,
  providerAccountRefV1,
  sha256Hex,
  type ConnectionAccountSnapshotV2,
  type ProfileConnectionV2,
} from '../packages/core/src/index.js';
import { MultiConnectionPaperCampaignService } from '../packages/services/src/index.js';
import {
  openDatabase,
  saveConnectionAccountSnapshotV2,
  saveProfileConnectionV2,
  saveProviderAccountRef,
  saveUnifiedPortfolioSnapshotV2,
} from '../packages/storage/src/index.js';

const PROFILE = 'profile-a';
const AT = 1_900_000_000_000;

function snapshot(connection: ProfileConnectionV2, asset: string, quantity: string,
  priceUsd: string | null, cashUsd: string): ConnectionAccountSnapshotV2 {
  const account = providerAccountRefV1(connection, `${connection.provider}-account`, AT);
  const complete = priceUsd !== null;
  const balances = [{ accountRefId: account.id, exposureKey: assetExposureKey(asset),
    instrument: { venue: connection.provider, productId: `${asset}-USD`, productType: 'spot' as const },
    availableQuantity: quantity, heldQuantity: '0', totalQuantity: quantity, priceUsd,
    valueUsd: priceUsd === null ? null : String(Number(quantity) * Number(priceUsd)) },
  { accountRefId: account.id, exposureKey: assetExposureKey('USD'), instrument: null,
    availableQuantity: cashUsd, heldQuantity: '0', totalQuantity: cashUsd, priceUsd: '1', valueUsd: cashUsd }];
  const material = { schemaVersion: 2 as const, profileId: PROFILE, connectionId: connection.id,
    provider: connection.provider, asOfMs: AT, balances, cashUsd, buyingPowerUsd: cashUsd,
    pendingOrderIds: [] as string[], permissions: { accountRead: true, marketRead: true,
      orderRead: true, trade: false as const }, rulesHash: sha256Hex(`rules:${connection.id}`),
    feeEvidenceHash: sha256Hex(`fees:${connection.id}`), health: complete ? 'healthy' as const : 'degraded' as const,
    failureReason: complete ? null : 'valuation_incomplete', complete,
    provenance: { source: connection.provider, requestedAtMs: AT - 1, receivedAtMs: AT } };
  const contentHash = connectionAccountSnapshotV2Hash({ ...material, id: '', contentHash: '' });
  return { ...material, id: sha256Hex(`connection-account-snapshot-v2:${contentHash}`), contentHash };
}

function persist(database: ReturnType<typeof openDatabase>, connection: ProfileConnectionV2,
  value: ConnectionAccountSnapshotV2): void {
  saveProfileConnectionV2(connection, database);
  saveProviderAccountRef(providerAccountRefV1(connection, `${connection.provider}-account`, AT), database);
  saveConnectionAccountSnapshotV2(value, database);
}

describe('multi-connection paper campaign', () => {
  it('requires confirmation and seeds each connection exactly once from fully priced evidence', () => {
    const database = openDatabase(':memory:');
    const coinbase = profileConnectionV2(PROFILE, 'coinbase', sha256Hex('coinbase-key'), AT);
    const robinhood = profileConnectionV2(PROFILE, 'robinhood_crypto', sha256Hex('robinhood-key'), AT);
    const sources = [snapshot(coinbase, 'BTC', '1', '50000', '100'),
      snapshot(robinhood, 'ETH', '2', '2500', '0')];
    persist(database, coinbase, sources[0]!); persist(database, robinhood, sources[1]!);
    const unified = buildUnifiedPortfolioSnapshotV2(PROFILE, sources, AT);
    saveUnifiedPortfolioSnapshotV2(unified, database);
    const service = new MultiConnectionPaperCampaignService(database, () => AT + 1);
    expect(service.start(PROFILE, 'command-a', false)).toEqual({ ok: false, code: 'confirmation_required' });

    const first = service.start(PROFILE, 'command-a', true);
    const retry = service.start(PROFILE, 'command-a', true);
    expect(first).toEqual(retry);
    expect(first).toMatchObject({ ok: true, books: [
      { connectionId: coinbase.id, cashUsd: '100', balances: [{ exposureKey: 'BTC', quantity: '1' }] },
      { connectionId: robinhood.id, cashUsd: '0', balances: [{ exposureKey: 'ETH', quantity: '2' }] },
    ] });
    expect(database.prepare('SELECT COUNT(*) AS count FROM multi_connection_paper_campaigns_v1').get())
      .toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM paper_connection_book_snapshots_v1').get())
      .toEqual({ count: 2 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM paper_book_origins_v1').get())
      .toEqual({ count: 0 });
    expect(() => database.prepare('DELETE FROM paper_connection_book_snapshots_v1').run()).toThrow();
    database.close();
  });

  it('refuses incomplete pricing without creating a partial campaign', () => {
    const database = openDatabase(':memory:');
    const connection = profileConnectionV2(PROFILE, 'coinbase', sha256Hex('key'), AT);
    const source = snapshot(connection, 'DOGE', '10', null, '0');
    persist(database, connection, source);
    saveUnifiedPortfolioSnapshotV2(buildUnifiedPortfolioSnapshotV2(PROFILE, [source], AT), database);
    const service = new MultiConnectionPaperCampaignService(database, () => AT + 1);
    expect(service.start(PROFILE, 'command-b', true)).toEqual({ ok: false, code: 'portfolio_incomplete' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM multi_connection_paper_campaigns_v1').get())
      .toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM paper_connection_book_snapshots_v1').get())
      .toEqual({ count: 0 });
    database.close();
  });
});
