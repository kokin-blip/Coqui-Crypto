import type { InstrumentIdentity } from '../types/index.js';

export interface PaperPortfolioBalanceV1 {
  readonly assetId: string;
  readonly quantity: string;
  readonly priceUsd: string;
  readonly valueUsd: string;
}

export interface PaperPortfolioSnapshotV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly source: 'tracked_holdings_opening' | 'paper_ledger';
  readonly balances: readonly PaperPortfolioBalanceV1[];
  readonly cashUsd: string;
  readonly asOfMs: number;
}

export interface PaperPendingExecutionV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly profileId: string;
  readonly decisionId: string;
  readonly orderId: string;
  readonly instrument: InstrumentIdentity;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly requestedUsd: string;
  readonly requiredExecutionBarStartMs: number;
  readonly productRuleSnapshotId: string;
  readonly costModelHash: string;
  readonly status: 'submitted' | 'filled' | 'expired';
  readonly submittedAtMs: number;
  readonly settledAtMs: number | null;
}

export interface PaperCampaignPlanV2 {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly profileId: string;
  readonly strategyId: 'trendvol';
  readonly strategyVersion: 'trendvol-paper-v1-unvalidated';
  readonly configHash: string;
  readonly codeHash: string;
  readonly evidenceSchemaVersion: 1;
  readonly costModelHash: string;
  readonly prospectiveStartMs: number;
  readonly createdAtMs: number;
}
