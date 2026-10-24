import type { FeasibilityPolicyV1, CapitalFeasibilityReportV1 } from '../execution/capital-feasibility.js';
import type { NativeExecutionRulesV1 } from '../execution/native-rules.js';
import type { CapitalMetric } from '../portfolio/capital-ledger.js';
import type { CapitalPerformanceReport } from '../portfolio/capital-performance.js';
import type { ReserveSettings, ReserveState, ReservePreview } from '../portfolio/profit-reserve.js';
import type { ReserveAssessment } from '../portfolio/profit-reserve-state.js';

export const CAPITAL_REPLAY_VERSION = 'capital-aware-replay-v1' as const;
export const CAPITAL_REPLAY_GRID = ['50','100','250','500','1000','2500','5000','10000','100000'] as const;
export const CAPITAL_REPLAY_DAY = 86_400_000;
export type ReplayArm = 'policy' | 'reinvest' | 'cash' | 'hold' | 'passive';
export interface ReplayOpening {
  readonly capitalUsd: string; readonly cashUsd: string;
  readonly assets: readonly { readonly assetId: string; readonly quantity: string; readonly costUsd: string | null }[];
}
export interface ReplayCost {
  readonly id: string; readonly venue: 'coinbase' | 'alpaca'; readonly role: 'taker';
  readonly feeRate: string; readonly feeCurrency: 'USD' | 'received' | 'unsupported';
  readonly feeBasis: 'execution_notional' | 'reference_notional'; readonly fixedUsd: string;
  readonly spreadBps: string; readonly slippageBps: string; readonly impactBps: string;
  readonly impactRefUsd: string; readonly multiplier: 1 | 2;
  readonly feePostingLagFrames: number; readonly sourceRef: string;
}
export interface ReplayRule {
  readonly assetId: string; readonly mode: 'static_scenario' | 'historical_observation';
  readonly fromMs: number; readonly toMs: number; readonly rules: NativeExecutionRulesV1;
}
export interface ReplayFlow {
  readonly id: string; readonly atMs: number; readonly sequence: number;
  readonly kind: 'contribution' | 'withdrawal' | 'pending_outflow' | 'confirm_outflow' | 'reverse_outflow' | 'release' | 'fee_adjustment' | 'income' | 'internal_transfer';
  readonly amountUsd: string; readonly feeUsd: string; readonly userReceiptUsd: string;
  readonly purpose: 'principal' | 'profit' | 'personal_tax' | 'other'; readonly linkedId: string | null;
  readonly fromReserve: boolean; readonly evidenceComplete: boolean;
}
export interface ReplayVariant {
  readonly id: string; readonly cost: ReplayCost; readonly policy: FeasibilityPolicyV1;
  readonly turnoverWindowMs: number; readonly flows: readonly ReplayFlow[];
  readonly reserve: ReserveSettings; readonly activationAtMs: number;
  readonly reviewAtMs: readonly number[]; readonly operatingObjective: 'fixed_request' | 'cash_only';
  readonly activeDailyYield: string; readonly reserveDailyYield: string;
  readonly externalExpenses: readonly { readonly atMs: number; readonly amountUsd: string }[];
}
export interface ReplayCell {
  readonly id: string; readonly capitalUsd: string; readonly variantId: string; readonly arm: ReplayArm;
}
export interface CapitalReplaySpecV1 {
  readonly version: typeof CAPITAL_REPLAY_VERSION; readonly mode: 'offline_development';
  readonly confirmatoryEligible: false; readonly liveExecutionPermitted: false;
  readonly supersedesSpecHash: string | null;
  readonly originProfileId: string; readonly workspaceId: string; readonly codeRevision: string;
  readonly sourceManifestHash: string; readonly lockfileHash: string;
  readonly exposure: 'synthetic' | 'exposed_development'; readonly provider: 'coinbase' | 'alpaca';
  readonly fromMs: number; readonly toMs: number; readonly warmupFromMs: number;
  readonly publicationDelayMs: number; readonly availabilityBasis: 'assumed_publication' | 'observed';
  readonly marketTapeHash: string; readonly decisionTapeHash: string; readonly pathId: string; readonly seed: number;
  readonly assets: readonly string[]; readonly openings: readonly ReplayOpening[];
  readonly variants: readonly ReplayVariant[]; readonly cells: readonly ReplayCell[]; readonly rules: readonly ReplayRule[];
  readonly benchmarkWeights: Readonly<Record<string, string>>; readonly passiveCadenceFrames: number;
  readonly sourceRefs: readonly string[];
}
export interface ReplayMarketAsset {
  readonly openUsd: string | null; readonly closeUsd: string | null;
  readonly bidUsd: string | null; readonly askUsd: string | null; readonly quoteAtMs: number | null;
  readonly tradable: boolean; readonly sourceRef: string;
}
export interface ReplayMarketFrame {
  readonly atMs: number; readonly endMs: number; readonly assets: Readonly<Record<string, ReplayMarketAsset>>;
}
export interface ReplayDecision {
  readonly id: string; readonly executionAtMs: number; readonly decisionAtMs: number;
  readonly availableAtMs: number; readonly observedThroughMs: number; readonly policyHash: string;
  readonly status: 'targets' | 'abstain' | 'not_scheduled' | 'insufficient_history';
  readonly targets: Readonly<Record<string, string>>; readonly riskExits: readonly string[];
  readonly priority: readonly string[]; readonly fill: { readonly fraction: string; readonly delayFrames: number | null };
}
export interface CapitalReplayTapeV1 {
  readonly market: readonly ReplayMarketFrame[]; readonly decisions: readonly ReplayDecision[];
}
export interface ReplayFill {
  readonly id: string; readonly assetId: string; readonly atMs: number; readonly sequence: number;
  readonly side: 'buy' | 'sell'; readonly quantity: string; readonly deliveredQuantity: string;
  readonly executionPriceUsd: string; readonly notionalUsd: string; readonly cashDebitUsd: string; readonly cashCreditUsd: string;
  readonly feeUsd: string; readonly feeAsset: string; readonly feeQuantity: string; readonly fixedFeeUsd: string;
  readonly spreadUsd: string; readonly slippageUsd: string; readonly impactUsd: string; readonly postingAtMs: number;
}
export interface CapitalReplayEventV1 {
  readonly id: string; readonly previousId: string | null; readonly atMs: number; readonly sequence: number;
  readonly kind: string; readonly sourceId: string; readonly detail: string;
  readonly cashUsd: string; readonly positions: Readonly<Record<string, string>>;
}
export interface ReplayTrace {
  readonly atMs: number; readonly phase: 'open' | 'close'; readonly equityUsd: string | null;
  readonly activeUsd: string | null; readonly cashUsd: string; readonly spendableUsd: string | null;
  readonly reservedUsd: string; readonly taxHoldUsd: string; readonly pendingUsd: string;
  readonly positions: Readonly<Record<string, string>>; readonly targets: Readonly<Record<string, string>>;
  readonly desired: Readonly<Record<string, string>>; readonly maximumWeight: string | null;
  readonly drift: string | null; readonly reasonCodes: readonly string[];
}
export interface ReplayCellResult {
  readonly id: string; readonly cell: ReplayCell; readonly state: 'complete' | 'infeasible' | 'unavailable' | 'failed';
  readonly reasonCodes: readonly string[]; readonly scopeId: string;
  readonly fills: readonly ReplayFill[]; readonly events: readonly CapitalReplayEventV1[]; readonly traces: readonly ReplayTrace[];
  readonly feasibility: readonly CapitalFeasibilityReportV1[];
  readonly reservePreviews: readonly ReservePreview[]; readonly assessments: readonly ReserveAssessment[];
  readonly reserveState: ReserveState | null;
  readonly totalPerformance: readonly CapitalPerformanceReport[]; readonly sleevePerformance: readonly CapitalPerformanceReport[];
  readonly metrics: Readonly<Record<string, CapitalMetric>>;
  readonly summary: { readonly endingEquityUsd: string | null; readonly activeUsd: string | null; readonly reservedUsd: string;
    readonly taxHoldUsd: string; readonly receiptsUsd: string; readonly contributionsUsd: string; readonly outflowsUsd: string;
    readonly turnoverUsd: string; readonly feesUsd: string; readonly spreadUsd: string; readonly slippageUsd: string;
    readonly impactUsd: string; readonly externalExpenseUsd: string; readonly userNetOutcomeUsd: string | null;
    readonly requestedOrders: number; readonly blockedOrders: number; readonly executedFills: number; readonly floorBreaches: number };
}
export interface CapitalReplayResultV1 {
  readonly id: string; readonly version: typeof CAPITAL_REPLAY_VERSION; readonly specHash: string;
  readonly mode: 'offline_development'; readonly confirmatoryEligible: false; readonly liveExecutionPermitted: false;
  readonly cells: readonly ReplayCellResult[]; readonly variantInventory: readonly ReplayCell[];
  readonly comparisons: readonly { readonly cellId: string; readonly controlId: string; readonly outcomeDifferenceUsd: string | null }[];
  readonly limitations: readonly string[];
}
