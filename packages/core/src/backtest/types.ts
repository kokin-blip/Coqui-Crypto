import type { TradeCostConfig } from '../costs/index.js';
import type {
  AssetSignal,
  MomentumConfig,
  RotationConfig,
  TiltConfig,
  VolTargetConfig,
} from '../strategies/index.js';
import type { Clock } from '../time/index.js';
import type { TrialRegistrySnapshot } from '../trials/index.js';
import type { InstrumentKey } from '../types/index.js';
import type { WalkForwardResult } from '../validation/index.js';

export interface EquityPoint {
  t: number;
  value: number;
}

export interface StrategyMetrics {
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
}

export interface StrategyCostSummary {
  turnoverUsd: number;
  totalCostUsd: number;
  costPctOfStart: number;
  events: number;
}

export interface TrackResult {
  equity: EquityPoint[];
  metrics: StrategyMetrics;
  costs: StrategyCostSummary;
}

export type SignificanceVerdict = 'significant' | 'inconclusive' | 'no_edge' | 'insufficient_data';

export interface SignificanceReport {
  trials: number;
  sampleDays: number;
  leader: string;
  leaderSharpe: number | null;
  psr: number | null;
  dsr: number | null;
  verdict: SignificanceVerdict;
  note: string;
}

export interface StrategyBacktestResult {
  runAtMs: number;
  hold: TrackResult;
  passive: TrackResult;
  signal: TrackResult;
  momentum: TrackResult;
  voltarget: TrackResult;
  trendvol: TrackResult;
  rotation: TrackResult;
  significance: SignificanceReport;
  walkForward: WalkForwardResult;
  assets: InstrumentKey[];
  days: number;
  rebalanceEveryDays: number;
}

export interface DecisionStrategyBacktestResult extends StrategyBacktestResult {
  executionModel: 'next_open' | 'next_close_conservative';
  datasetHash: string;
}

export type ConcreteAutoStrategy =
  | 'passive'
  | 'signal'
  | 'momentum'
  | 'voltarget'
  | 'trendvol'
  | 'rotation';

export type SignalEvaluator = (
  closes: number[],
) => { action: AssetSignal['action']; rsi: number | null; regime: AssetSignal['regime'] } | null;

export interface StrategyBacktestOptions {
  clock: Clock;
  warmup: number;
  rebalanceEveryDays: number;
  tradeCosts?: TradeCostConfig;
  tilt?: TiltConfig;
  momentum?: MomentumConfig;
  volTarget?: VolTargetConfig;
  rotation?: RotationConfig;
  cashAprPct?: number;
  exposureScale?: number[];
  executionPricesById?: Partial<Record<InstrumentKey, number[]>>;
  trialRegistry?: TrialRegistrySnapshot;
  evalSignal: SignalEvaluator;
}
