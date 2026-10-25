import type { ReserveSettings, ReserveFinancialInput, ReserveMetric } from './profit-reserve.js';
import type { ReserveCapitalWitness } from './reserve-capital-witness.js';
export const PAPER_RESERVE_VERSION = 'paper-reserve-cash-v1' as const;
export interface PaperReserveStrategy {
  readonly strategyId: string; readonly codeRevision: string; readonly costProfileHash: string;
  readonly horizonMs: number; readonly normalization: 'gross_pct_per_turnover';
}
export interface PaperReservePolicy {
  readonly id: string; readonly version: typeof PAPER_RESERVE_VERSION; readonly scopeId: string; readonly originProfileId: string;
  readonly previousId: string | null; readonly createdAtMs: number; readonly settings: ReserveSettings;
  readonly strategy: PaperReserveStrategy; readonly requirementsId: string; readonly reviewMode: 'every_mutation';
}
export interface PaperReserveState {
  readonly id: string; readonly domain: typeof PAPER_RESERVE_VERSION; readonly scopeId: string; readonly streamId: string;
  readonly policyId: string; readonly previousId: string | null; readonly operationKey: string; readonly atMs: number;
  readonly event: 'baseline' | 'assessment' | 'release'; readonly hUsd: string; readonly excludedProfitUsd: string;
  readonly baseUsd: string; readonly baseProfitUsd: string; readonly cycle: { readonly id: string; readonly ceilingUsd: string } | null;
  readonly balanceConsumed: boolean; readonly allocatedUsd: string; readonly reservedUsd: string; readonly taxHoldUsd: string;
  readonly profitBackedTaxUsd: string; readonly pendingUsd: string; readonly evidenceRefs: readonly string[];
}
export interface PaperReserveProposal {
  readonly id: string; readonly version: typeof PAPER_RESERVE_VERSION; readonly scopeId: string; readonly policyId: string;
  readonly stateId: string; readonly requirementsId: string; readonly evaluatedAtMs: number; readonly expiresAtMs: number;
  readonly state: 'eligible' | 'deferred' | 'unavailable' | 'disabled'; readonly reasonCodes: readonly string[];
  readonly financial: ReserveFinancialInput; readonly operatingRequirement: ReserveCapitalWitness;
  readonly triggerReached: boolean; readonly wouldRequestReview: boolean; readonly cycleCeilingUsd: string | null;
  readonly reserveUsd: ReserveMetric; readonly assessedProfitUsd: ReserveMetric; readonly retainedActiveUsd: ReserveMetric;
  readonly additionalTaxUsd: string; readonly roundingResidualUsd: ReserveMetric;
  readonly caps: { readonly economicUsd: ReserveMetric; readonly realizedUsd: ReserveMetric; readonly cashUsd: ReserveMetric; readonly capitalUsd: ReserveMetric };
  readonly inputHash: string; readonly liveExecutionPermitted: false; readonly externalWithdrawalPermitted: false;
}

export interface PaperReserveAuthorityProof {
  readonly hash:string; readonly profileId:string; readonly hostGeneration:number; readonly fencingToken:number;
  readonly evidenceHash:string; readonly policyHash:string; readonly grossEdgeLowerBoundPct:number;
}
