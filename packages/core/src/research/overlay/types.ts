import type { MomentumConfig, VolTargetConfig } from '../../strategies/index.js';
import type { InstrumentKey } from '../../types/index.js';
import type { IntegrityStudyPlan } from '../integrity-plan.js';
import type { ResearchBook, ResearchFill } from '../../backtest/integrity-book.js';
import type { TrackResult } from '../../backtest/types.js';
import type { ValidatedDecisionFrame } from '../../backtest/execution-timing.js';
export const OVERLAY_VERSION = 'participation-tilt-v1' as const;
export const FEATURE_VERSION = 'daily-five-v1' as const;
export type Abstention = 'skip_rebalance' | 'cash_exit';
export type GateKind = 'none' | 'volatility' | 'trend' | 'combined' | 'ml';
export interface OverlayCandidate {
  readonly id: string; readonly cadence: 1 | 14; readonly gate: GateKind;
  readonly volatilityMultiple: number; readonly abstention: Abstention;
  readonly model: 'none' | 'ridge' | 'tree'; readonly modelParameter: number;
  readonly probabilityThreshold: number; readonly tilt: boolean;
  readonly maxDeviation: 0.025 | 0.05; readonly diagnosticOnly: boolean;
}
export interface OverlayArm { readonly cadence: 1 | 14; readonly anchorMs: number }
export interface OverlayStudyPlan extends Omit<IntegrityStudyPlan, 'schemaVersion' | 'engineVersion'> {
  readonly schemaVersion: 3; readonly overlayVersion: typeof OVERLAY_VERSION;
  readonly arms: readonly OverlayArm[];
  readonly baseline: { readonly momentum: MomentumConfig; readonly volatility: VolTargetConfig };
  readonly featureVersion: typeof FEATURE_VERSION;
  readonly minimumTraining: 120; readonly minimumCalibration: 60; readonly minimumValidation: 30;
  readonly taxDragPct: 0;
  readonly developmentLiquidityHash: string;
}
export interface LiquidityObservation {
  readonly assetId: InstrumentKey; readonly usdVolume: string;
  readonly availableAtMs: number; readonly observedThroughMs: number;
  readonly sourceHash: string; readonly volumeUnit: 'USD';
}
export interface OverlayRow {
  readonly decisionAtMs: number; readonly executionAtMs: number; readonly labelEndMs: number;
  readonly labelAvailableAtMs: number; readonly features: readonly (readonly number[])[];
  readonly forwardReturns: readonly number[];
}
export interface TreeNode { readonly value: number; readonly feature?: number; readonly split?: number;
  readonly left?: TreeNode; readonly right?: TreeNode }
export interface OverlayModel {
  readonly kind: 'ridge' | 'tree'; readonly version: typeof OVERLAY_VERSION; readonly parameter: number;
  readonly means: readonly (readonly number[])[]; readonly scales: readonly (readonly number[])[];
  readonly coefficients: readonly (readonly number[])[]; readonly trees: readonly TreeNode[];
  readonly trainedThroughMs: number;
}
export interface SigmoidCalibration { readonly intercept: number; readonly slope: number; readonly observations: number }
export interface OverlayArtifact {
  readonly version: typeof OVERLAY_VERSION; readonly candidateId: string; readonly model: OverlayModel;
  readonly participation: SigmoidCalibration | null; readonly tilt: SigmoidCalibration | null;
  readonly trainingWindow: { readonly startMs: number; readonly endExclusiveMs: number };
  readonly calibrationWindow: { readonly startMs: number; readonly endExclusiveMs: number };
  readonly features: typeof FEATURE_VERSION; readonly label: 'attainable-open-horizon-gross-return';
  readonly cadence: 1 | 14; readonly assets: readonly InstrumentKey[];
  readonly planHash: string; readonly datasetHash: string; readonly costHash: string; readonly riskHash: string;
  readonly sourceManifestHash: string; readonly lockfileHash: string; readonly seed: number;
  readonly evaluationResultHash: string | null;
  readonly liquidityHash: string;
  readonly updatePolicy: 'explicit';
  readonly futureRefitContract: 'registered-schedule-separate-qualification';
}
export interface OverlayTrace {
  readonly frame: ValidatedDecisionFrame; readonly scheduled: boolean;
  readonly reason: string; readonly permitted: boolean | null; readonly fallback: boolean;
  readonly baselineBelowTrend: boolean | null; readonly baselineExposure: number;
  readonly probability: number | null; readonly prediction: readonly number[] | null;
  readonly targets: readonly { readonly assetId: InstrumentKey; readonly weight: number }[];
  readonly evaluatedTargets: readonly { readonly assetId: InstrumentKey; readonly weight: number }[];
  readonly referenceTargets: readonly { readonly assetId: InstrumentKey; readonly weight: number }[] | null;
  readonly risk: { readonly peak: number; readonly priorObserved: number; readonly stopped: boolean };
  readonly fills: readonly ResearchFill[]; readonly bookBefore: ResearchBook; readonly book: ResearchBook;
}
export interface OverlayReplay extends TrackResult {
  readonly traces: readonly OverlayTrace[];
  readonly coverage: { readonly eligible: number; readonly selected: number; readonly rejected: number; readonly fallback: number };
  readonly componentCosts: Readonly<{ fee: string; spread: string; slippage: string; impact: string }>;
  readonly overlap: { readonly belowTrend: number; readonly rejectedBelowTrend: number };
}
