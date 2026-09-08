import {
  createMultiConnectionPaperCampaign,
  createPaperConnectionBookSnapshot,
  type MultiConnectionPaperCampaignV1,
  type PaperConnectionBookSnapshotV1,
} from '@coqui/core';
import {
  getConnectionAccountSnapshotV2,
  getLatestUnifiedPortfolioSnapshotV2,
  getMultiConnectionPaperCampaignByCommand,
  latestMultiConnectionPaperCampaign,
  paperConnectionBooks,
  saveMultiConnectionPaperCampaign,
  type Db,
} from '@coqui/storage';

export type MultiConnectionCampaignStartResult = { readonly ok: true; readonly campaign: MultiConnectionPaperCampaignV1; readonly books: readonly PaperConnectionBookSnapshotV1[] } |
  { readonly ok: false; readonly code: 'confirmation_required' | 'portfolio_unavailable' | 'portfolio_incomplete' | 'connection_snapshot_unavailable' };

export class MultiConnectionPaperCampaignService {
  constructor(private readonly database: Db, private readonly nowMs: () => number) {}

  start(profileId: string, commandId: string, confirmed: boolean): MultiConnectionCampaignStartResult {
    if (!confirmed) return { ok: false, code: 'confirmation_required' };
    const prior = getMultiConnectionPaperCampaignByCommand(profileId, commandId, this.database);
    if (prior !== null) return { ok: true, campaign: prior,
      books: paperConnectionBooks(prior.id, this.database) };
    const unified = getLatestUnifiedPortfolioSnapshotV2(profileId, false, this.database);
    if (unified === null) return { ok: false, code: 'portfolio_unavailable' };
    if (!unified.complete || !unified.exposures.some((exposure) =>
      exposure.exposureKey !== 'USD' && exposure.quantity !== '0')) {
      return { ok: false, code: 'portfolio_incomplete' };
    }
    const sources = unified.connectionSnapshotIds.map((id) => getConnectionAccountSnapshotV2(profileId, id, this.database));
    if (sources.some((source) => source === null || !source.complete ||
      source.balances.some((balance) => balance.priceUsd === null || balance.valueUsd === null))) {
      return { ok: false, code: 'connection_snapshot_unavailable' };
    }
    const startedAtMs = this.nowMs();
    const campaign = createMultiConnectionPaperCampaign({ profileId, commandId,
      sourceUnifiedSnapshotId: unified.id, startedAtMs });
    const books = sources.map((source) => createPaperConnectionBookSnapshot({
      campaignId: campaign.id, profileId, connectionId: source!.connectionId, provider: source!.provider,
      sourceConnectionSnapshotId: source!.id, cashUsd: source!.cashUsd ?? '0', createdAtMs: startedAtMs,
      balances: source!.balances.filter((balance) => balance.exposureKey !== 'USD')
        .map((balance) => ({ exposureKey: balance.exposureKey,
          quantity: balance.totalQuantity, valueUsd: balance.valueUsd! })),
    })).sort((left, right) => left.provider.localeCompare(right.provider) ||
      left.connectionId.localeCompare(right.connectionId));
    saveMultiConnectionPaperCampaign(campaign, books, this.database);
    return Object.freeze({ ok: true, campaign, books: Object.freeze(books) });
  }

  status(profileId: string) { return latestMultiConnectionPaperCampaign(profileId, this.database); }
}
