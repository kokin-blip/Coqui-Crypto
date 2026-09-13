import { Decimal } from 'decimal.js';

import {
  canonicalJson,
  DEFAULT_MOMENTUM_CONFIG,
  DEFAULT_VOL_TARGET_CONFIG,
  exploratoryCampaignHash,
  sha256Hex,
  validateExploratoryOpeningBalances,
  type CanonicalJsonValue,
  type ExploratoryPaperCampaignV1,
  type InstrumentIdentity,
  type UnifiedPortfolioSnapshotV2,
} from '@coqui/core';
import {
  countSubmittedExploratoryPaperExecutions,
  currentExploratoryPaperCampaign,
  getExploratoryPaperCampaignByCommand,
  getLatestUnifiedPortfolioSnapshotV2,
  listSubmittedPaperExecutions,
  saveExploratoryPaperCampaign,
  transitionExploratoryPaperCampaign,
  type Db,
} from '@coqui/storage';

import { paperCostModelHash } from './venue.js';
import type { PaperDecisionPreparation } from './runtime-model.js';

export const EXPLORATORY_TRENDVOL_VERSION = 'trendvol-exploratory-paper-v1' as const;

export type ExploratoryCampaignStartResult =
  | Readonly<{ ok: true; campaign: ExploratoryPaperCampaignV1;
      status: 'active' | 'paused' | 'stopping' | 'stopped' }>
  | Readonly<{ ok: false; code:
    | 'confirmation_required'
    | 'campaign_already_active'
    | 'portfolio_unavailable'
    | 'portfolio_incomplete'
    | 'pending_settlement'
    | 'market_unavailable'
    | 'no_decision_eligible_assets' }>;

export interface ExploratoryCampaignStartInput {
  readonly profileId: string;
  readonly commandId: string;
  readonly explicitConfirmation: boolean;
  readonly preparation: PaperDecisionPreparation;
  readonly instruments: readonly InstrumentIdentity[];
  readonly nowMs: number;
}

function fixed(value: Decimal): string {
  return value.toDecimalPlaces(18).toFixed();
}

function assetIdForExposure(
  exposureKey: string,
  instruments: readonly InstrumentIdentity[],
): string | null {
  const instrument = instruments.find((candidate) =>
    candidate.venue === 'coinbase' && candidate.productType === 'spot' &&
    candidate.productId === `${exposureKey}-USD`);
  return instrument === undefined ? null : `${instrument.venue}|${instrument.productType}|${instrument.productId}`;
}

export class ExploratoryPaperCampaignService {
  constructor(private readonly database: Db) {}

  start(input: ExploratoryCampaignStartInput): ExploratoryCampaignStartResult {
    if (!input.explicitConfirmation) return { ok: false, code: 'confirmation_required' };
    const retry = getExploratoryPaperCampaignByCommand(input.profileId, input.commandId, this.database);
    if (retry !== null) {
      const state = currentExploratoryPaperCampaign(input.profileId, this.database);
      return { ok: true, campaign: retry,
        status: state?.campaign.campaignId === retry.campaignId ? state.status : 'stopped' };
    }
    const current = currentExploratoryPaperCampaign(input.profileId, this.database);
    if (current !== null && current.status !== 'stopped') {
      return { ok: false, code: 'campaign_already_active' };
    }
    const unified = getLatestUnifiedPortfolioSnapshotV2(input.profileId, false, this.database);
    if (unified === null) return { ok: false, code: 'portfolio_unavailable' };
    if (!unified.complete || unified.totalValueUsd === null ||
        !unified.exposures.some((item) => item.exposureKey !== 'USD' && new Decimal(item.quantity).isPositive())) {
      return { ok: false, code: 'portfolio_incomplete' };
    }
    if (listSubmittedPaperExecutions(input.profileId, this.database).length > 0) {
      return { ok: false, code: 'pending_settlement' };
    }
    if (input.instruments.length === 0) return { ok: false, code: 'no_decision_eligible_assets' };
    if (!input.preparation.ok) return { ok: false, code: 'market_unavailable' };

    const eligible = new Set<string>(input.preparation.dataset.assets);
    const openingBalances = unified.exposures
      .filter((exposure) => exposure.exposureKey !== 'USD' && new Decimal(exposure.quantity).isPositive())
      .map((exposure) => {
        if (exposure.valueUsd === null) throw new TypeError('Complete portfolio has an unpriced exposure.');
        const assetId = assetIdForExposure(exposure.exposureKey, input.instruments);
        const managedAssetId = assetId !== null && eligible.has(assetId) ? assetId : null;
        const quantity = new Decimal(exposure.quantity);
        const value = new Decimal(exposure.valueUsd);
        return Object.freeze({
          exposureKey: exposure.exposureKey,
          assetId: managedAssetId,
          quantity: fixed(quantity),
          priceUsd: fixed(value.div(quantity)),
          valueUsd: fixed(value),
          managed: managedAssetId !== null,
          contributions: Object.freeze(exposure.contributions.map((item) => {
            if (item.valueUsd === null) throw new TypeError('Complete contribution has no value.');
            return Object.freeze({
              connectionId: item.connectionId, accountRefId: item.accountRefId,
              provider: item.provider, quantity: item.quantity, valueUsd: item.valueUsd,
            });
          })),
        });
      })
      .sort((left, right) => left.exposureKey.localeCompare(right.exposureKey));
    const cash = unified.exposures.find((item) => item.exposureKey === 'USD');
    const openingCashUsd = cash === undefined ? '0' : fixed(new Decimal(cash.quantity));
    const openingCashProvenance = cash === undefined ? 'unknown_assumed_zero' as const
      : 'connected_snapshot' as const;
    try {
      validateExploratoryOpeningBalances(openingBalances, openingCashUsd);
    } catch (error) {
      if (error instanceof Error && error.message.includes('at least one managed asset')) {
        return { ok: false, code: 'no_decision_eligible_assets' };
      }
      throw error;
    }
    const managedValue = openingBalances.filter((item) => item.managed)
      .reduce((sum, item) => sum.add(item.valueUsd), new Decimal(0));
    if (!managedValue.isPositive()) return { ok: false, code: 'no_decision_eligible_assets' };
    const baseWeights = openingBalances.filter((item) => item.managed).map((item) => Object.freeze({
      assetId: item.assetId!, weight: new Decimal(item.valueUsd).div(managedValue).toNumber(),
    }));
    const baseWeightsHash = sha256Hex(canonicalJson(baseWeights as unknown as CanonicalJsonValue));
    const campaignId = sha256Hex(`exploratory-paper:${input.profileId}:${input.commandId}:${unified.id}`);
    const material = {
      schemaVersion: 1 as const, campaignId, profileId: input.profileId, commandId: input.commandId,
      admissionMode: 'exploratory' as const, strategyId: EXPLORATORY_TRENDVOL_VERSION,
      sourcePortfolioSnapshotId: unified.id, sourcePortfolioHash: unified.contentHash,
      strategyConfigHash: sha256Hex(canonicalJson({ momentum: DEFAULT_MOMENTUM_CONFIG,
        volTarget: DEFAULT_VOL_TARGET_CONFIG } as unknown as CanonicalJsonValue)),
      strategyCodeHash: sha256Hex('trendvol-exploratory-paper-v1:shared-core-targets:pending-next-open'),
      costModelHash: paperCostModelHash(), baseWeights: Object.freeze(baseWeights), baseWeightsHash,
      openingBalances: Object.freeze(openingBalances), openingCashUsd, openingCashProvenance,
      openingEquityUsd: fixed(new Decimal(unified.totalValueUsd)), startedAtMs: input.nowMs,
      eligibleForValidation: false as const, eligibleForPromotion: false as const,
      eligibleForLiveExecution: false as const,
    };
    const campaign: ExploratoryPaperCampaignV1 = Object.freeze({
      ...material, contentHash: exploratoryCampaignHash(material),
    });
    saveExploratoryPaperCampaign(campaign, this.database);
    return Object.freeze({ ok: true, campaign, status: 'active' as const });
  }

  status(profileId: string) {
    return currentExploratoryPaperCampaign(profileId, this.database);
  }

  transition(input: {
    readonly profileId: string;
    readonly campaignId: string;
    readonly commandId: string;
    readonly action: 'pause' | 'resume' | 'stop';
    readonly nowMs: number;
  }) {
    const current = currentExploratoryPaperCampaign(input.profileId, this.database);
    if (current === null || current.campaign.campaignId !== input.campaignId) {
      return { ok: false as const, code: 'campaign_not_found' as const };
    }
    if (input.action === 'stop' && countSubmittedExploratoryPaperExecutions(
      input.campaignId, input.profileId, this.database,
    ) > 0) {
      return { ok: false as const, code: 'pending_settlement' as const };
    }
    const requested = input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'active' : 'stopping';
    let state = transitionExploratoryPaperCampaign({ profileId: input.profileId,
      campaignId: input.campaignId, commandId: input.commandId, status: requested,
      atMs: input.nowMs }, this.database);
    if (input.action === 'stop') {
      state = transitionExploratoryPaperCampaign({ profileId: input.profileId,
        campaignId: input.campaignId, commandId: sha256Hex(`${input.commandId}:complete`),
        status: 'stopped', atMs: input.nowMs }, this.database);
    }
    return { ok: true as const, value: state! };
  }

  latestUnified(profileId: string): UnifiedPortfolioSnapshotV2 | null {
    return getLatestUnifiedPortfolioSnapshotV2(profileId, false, this.database);
  }
}
