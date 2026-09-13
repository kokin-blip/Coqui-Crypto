import { Decimal } from 'decimal.js';

import { sha256Hex } from '../crypto/sha256.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/index.js';
import type { AssetExposureKey } from '../connections/index.js';

export type PaperAdmissionModeV1 = 'validated' | 'exploratory';

export type ProfitabilityAssessmentV1 =
  | Readonly<{
      status: 'assessed';
      historicalGrossEdgeLowerBoundPct: number;
      estimatedCostUsd: number;
      requiredEdgeUsd: number;
      outcome: 'passed' | 'would_refuse';
    }>
  | Readonly<{
      status: 'unavailable';
      historicalGrossEdgeLowerBoundPct: null;
      estimatedCostUsd: number;
      requiredEdgeUsd: number;
      reason: 'no_applicable_validated_edge';
    }>;

export type ExploratoryCampaignStatus = 'active' | 'paused' | 'stopping' | 'stopped';

export interface ExploratoryOpeningBalanceV1 {
  readonly exposureKey: AssetExposureKey;
  readonly assetId: string | null;
  readonly quantity: string;
  readonly priceUsd: string;
  readonly valueUsd: string;
  readonly managed: boolean;
  readonly contributions: readonly Readonly<{
    connectionId: string;
    accountRefId: string;
    provider: 'coinbase' | 'robinhood_crypto';
    quantity: string;
    valueUsd: string;
  }>[];
}

export interface ExploratoryPaperCampaignV1 {
  readonly schemaVersion: 1;
  readonly campaignId: string;
  readonly profileId: string;
  readonly commandId: string;
  readonly admissionMode: 'exploratory';
  readonly strategyId: 'trendvol-exploratory-paper-v1';
  readonly sourcePortfolioSnapshotId: string;
  readonly sourcePortfolioHash: string;
  readonly strategyConfigHash: string;
  readonly strategyCodeHash: string;
  readonly costModelHash: string;
  readonly baseWeights: readonly Readonly<{ assetId: string; weight: number }>[];
  readonly baseWeightsHash: string;
  readonly openingBalances: readonly ExploratoryOpeningBalanceV1[];
  readonly openingCashUsd: string;
  readonly openingCashProvenance: 'connected_snapshot' | 'unknown_assumed_zero';
  readonly openingEquityUsd: string;
  readonly startedAtMs: number;
  readonly eligibleForValidation: false;
  readonly eligibleForPromotion: false;
  readonly eligibleForLiveExecution: false;
  readonly contentHash: string;
}

export interface ExploratoryPaperBalanceV1 {
  readonly campaignId: string;
  readonly exposureKey: AssetExposureKey;
  readonly assetId: string | null;
  readonly quantity: string;
  readonly managed: boolean;
  readonly updatedAtMs: number;
}

export interface ExploratoryPaperValuationV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly campaignId: string;
  readonly profileId: string;
  readonly asOfMs: number;
  readonly equityUsd: string | null;
  readonly buyAndHoldBenchmarkUsd: string | null;
  readonly estimatedCostsUsd: string;
  readonly unpricedCount: number;
  readonly contentHash: string;
}

export function exploratoryCampaignHash(value: Omit<ExploratoryPaperCampaignV1, 'contentHash'>): string {
  return sha256Hex(canonicalJson(value as unknown as CanonicalJsonValue));
}

export function exploratoryValuationHash(value: Omit<ExploratoryPaperValuationV1, 'id' | 'contentHash'>): string {
  return sha256Hex(canonicalJson(value as unknown as CanonicalJsonValue));
}

export function validateExploratoryOpeningBalances(
  balances: readonly ExploratoryOpeningBalanceV1[],
  cashUsd: string,
): void {
  const seen = new Set<string>();
  const cash = new Decimal(cashUsd);
  if (!cash.isFinite() || cash.isNegative()) throw new TypeError('Exploratory cash must be nonnegative.');
  if (balances.length === 0) throw new TypeError('Exploratory opening portfolio is empty.');
  for (const balance of balances) {
    const quantity = new Decimal(balance.quantity);
    const price = new Decimal(balance.priceUsd);
    const value = new Decimal(balance.valueUsd);
    if (seen.has(balance.exposureKey) || !quantity.isFinite() || quantity.isNegative() ||
        !price.isFinite() || !price.isPositive() || !value.isFinite() || value.isNegative()) {
      throw new TypeError('Exploratory opening balances must be unique, nonnegative, and fully priced.');
    }
    if (balance.managed !== (balance.assetId !== null)) {
      throw new TypeError('Managed exploratory balances require a decision instrument.');
    }
    seen.add(balance.exposureKey);
  }
  if (!balances.some((balance) => balance.managed && new Decimal(balance.quantity).isPositive())) {
    throw new TypeError('Exploratory campaign requires at least one managed asset.');
  }
}
