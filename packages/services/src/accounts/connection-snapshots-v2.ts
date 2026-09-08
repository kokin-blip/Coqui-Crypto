import { Decimal } from 'decimal.js';

import {
  assetExposureKey,
  buildUnifiedPortfolioSnapshotV2,
  connectionAccountSnapshotV2Hash,
  instrumentKey,
  profileConnectionV2,
  providerAccountRefV1,
  sha256Hex,
  type CoinbaseAccountEvidence,
  type CoinbaseFeeTierEvidence,
  type ConnectionAccountBalanceV2,
  type ConnectionAccountSnapshotV2,
  type PriceSource,
  type ProfileConnectionV2,
  type SpotPriceObservation,
  type UnifiedPortfolioSnapshotV2,
} from '@coqui/core';
import {
  ensureLegacyCoinbaseConnection,
  getLatestConnectionAccountSnapshotV2,
  getProfileConnectionV2,
  linkProfileConnectionMigration,
  listProfileConnectionsV2,
  saveConnectionAccountSnapshotV2,
  saveProfileConnectionV2,
  saveProviderAccountRef,
  saveUnifiedPortfolioSnapshotV2,
  type Db,
} from '@coqui/storage';

function validPrice(observation: SpotPriceObservation | undefined): string | null {
  if (observation === undefined) return null;
  const value = new Decimal(observation.priceUsd);
  return value.isFinite() && value.gt(0) ? value.toString() : null;
}

export interface PersistCoinbaseSnapshotV2Input {
  readonly profileId: string;
  readonly credentialFingerprint: string;
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  readonly accounts: readonly CoinbaseAccountEvidence[];
  readonly pendingOrderIds?: readonly string[];
  readonly feeTier?: CoinbaseFeeTierEvidence | null;
  readonly rulesHash?: string | null;
}

function unavailableSnapshot(connection: ProfileConnectionV2, atMs: number): ConnectionAccountSnapshotV2 {
  const material = {
    schemaVersion: 2 as const, profileId: connection.profileId, connectionId: connection.id,
    provider: connection.provider, asOfMs: atMs, balances: Object.freeze([]), cashUsd: null,
    buyingPowerUsd: null, pendingOrderIds: Object.freeze([]),
    permissions: Object.freeze({ accountRead: false, marketRead: false, orderRead: false, trade: false as const }),
    rulesHash: null, feeEvidenceHash: null, health: 'unavailable' as const,
    failureReason: 'snapshot_unavailable', complete: false,
    provenance: Object.freeze({ source: connection.provider, requestedAtMs: atMs, receivedAtMs: atMs }),
  };
  const contentHash = connectionAccountSnapshotV2Hash({ ...material, id: '', contentHash: '' });
  return Object.freeze({ ...material, id: sha256Hex(`connection-account-snapshot-v2:${contentHash}`), contentHash });
}

/** Materialize the v2 connection and current portfolio from one successful Coinbase acquisition. */
export async function persistCoinbasePortfolioSnapshotV2(
  input: PersistCoinbaseSnapshotV2Input,
  database: Db,
  priceSource: PriceSource,
): Promise<{ readonly connection: ProfileConnectionV2; readonly snapshot: ConnectionAccountSnapshotV2; readonly unified: UnifiedPortfolioSnapshotV2 }> {
  const candidate = profileConnectionV2(input.profileId, 'coinbase', input.credentialFingerprint, input.receivedAtMs);
  const connection = getProfileConnectionV2(input.profileId, candidate.id, database) ?? candidate;
  saveProfileConnectionV2(connection, database);
  const legacy = ensureLegacyCoinbaseConnection(input.profileId, input.credentialFingerprint, input.receivedAtMs, database);
  linkProfileConnectionMigration(legacy.id, connection.id, input.receivedAtMs, database);

  const activeAccounts = input.accounts.filter((account) => account.active && account.ready && new Decimal(account.totalQuantity).gt(0));
  const refs = new Map(activeAccounts.map((account) => {
    const ref = providerAccountRefV1(connection, account.accountUuid, input.receivedAtMs);
    saveProviderAccountRef(ref, database);
    return [account.accountUuid, ref] as const;
  }));
  const instruments = activeAccounts.filter((account) => account.currency !== 'USD').map((account) => ({
    venue: 'coinbase' as const, productId: `${account.currency}-USD`, productType: 'spot' as const,
  }));
  let observations: ReadonlyMap<string, SpotPriceObservation> = new Map();
  let pricingFailed = false;
  try {
    observations = instruments.length === 0 ? new Map() : await priceSource.spot(instruments);
  } catch {
    pricingFailed = true;
  }
  let complete = !pricingFailed;
  const balances: ConnectionAccountBalanceV2[] = activeAccounts
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.accountUuid.localeCompare(b.accountUuid))
    .map((account) => {
      const instrument = account.currency === 'USD' ? null : {
        venue: 'coinbase' as const, productId: `${account.currency}-USD`, productType: 'spot' as const,
      };
      const priceUsd = account.currency === 'USD' ? '1' : validPrice(observations.get(instrumentKey(instrument!)));
      if (priceUsd === null) complete = false;
      return Object.freeze({
        accountRefId: refs.get(account.accountUuid)!.id,
        exposureKey: assetExposureKey(account.currency), instrument,
        availableQuantity: String(account.availableQuantity), heldQuantity: String(account.holdQuantity),
        totalQuantity: String(account.totalQuantity), priceUsd,
        valueUsd: priceUsd === null ? null : new Decimal(account.totalQuantity).mul(priceUsd).toString(),
      });
    });
  const cashUsd = balances.filter((balance) => balance.exposureKey === 'USD')
    .reduce((sum, balance) => sum.plus(balance.totalQuantity), new Decimal(0)).toString();
  const material = {
    schemaVersion: 2 as const, profileId: input.profileId, connectionId: connection.id,
    provider: 'coinbase' as const, asOfMs: input.receivedAtMs, balances: Object.freeze(balances),
    cashUsd, buyingPowerUsd: cashUsd, pendingOrderIds: Object.freeze([...(input.pendingOrderIds ?? [])].sort()),
    permissions: Object.freeze({ accountRead: true, marketRead: true, orderRead: true, trade: false as const }),
    rulesHash: input.rulesHash ?? null,
    feeEvidenceHash: input.feeTier === undefined || input.feeTier === null ? null : sha256Hex(JSON.stringify(input.feeTier)),
    health: complete ? 'healthy' as const : 'degraded' as const,
    failureReason: complete ? null : 'valuation_incomplete', complete,
    provenance: Object.freeze({ source: 'coinbase' as const,
      requestedAtMs: input.requestedAtMs, receivedAtMs: input.receivedAtMs }),
  };
  const contentHash = connectionAccountSnapshotV2Hash({ ...material, id: '', contentHash: '' });
  const snapshot = Object.freeze({ ...material,
    id: sha256Hex(`connection-account-snapshot-v2:${contentHash}`), contentHash });
  saveConnectionAccountSnapshotV2(snapshot, database);

  const sources = listProfileConnectionsV2(input.profileId, database)
    .filter((candidate) => candidate.status !== 'disconnected')
    .map((candidate) => candidate.id === connection.id ? snapshot
      : getLatestConnectionAccountSnapshotV2(input.profileId, candidate.id, database) ?? unavailableSnapshot(candidate, input.receivedAtMs));
  const unified = buildUnifiedPortfolioSnapshotV2(input.profileId, sources, input.receivedAtMs);
  saveUnifiedPortfolioSnapshotV2(unified, database);
  return Object.freeze({ connection, snapshot, unified });
}
