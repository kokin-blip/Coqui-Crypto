import type {FeasibilityIntentV1} from '../execution/capital-feasibility.js';
import type { CapitalReplaySpecV1, ReplayVariant, ReplayMarketFrame, ReplayCellResult, ReplayDecision } from './capital-replay-types.js';
import type { MomentumConfig } from '../strategies/momentum.js';
import type { VolTargetConfig } from '../strategies/vol-target.js';
export type ContestMomentum=Omit<MomentumConfig,'lookbackDaysEnsemble'|'relativeScoreSpreadFloor'>&{readonly lookbackDaysEnsemble?:readonly number[]|undefined;readonly relativeScoreSpreadFloor?:number|undefined};
export const CAPITAL_CONTEST_VERSION='capital-contest-v1' as const;
export type ContestFamily='trend'|'rotation'|'allocator'|'hold'|'passive'|'cash'|'exposure';
export interface ContestCandidateV1 {
 readonly id:string;readonly family:ContestFamily;readonly lookbackDays:number;readonly volatilityDays:number;
 readonly cadenceDays:number;readonly anchorMs:number;readonly decisionDelayMs:number;
 readonly baseWeights:Readonly<Record<string,string>>;readonly topN:number;readonly buffer:number;
 readonly weighting:'equal'|'inverse_vol'|'hrp';readonly dustUsd:string;
 readonly momentum:ContestMomentum|null;readonly volatility:VolTargetConfig|null;readonly exposureOf:string|null;
}
export interface ContestArmV1 {
 readonly id:string;readonly candidateId:string;readonly group:'S'|'V'|'E'|'R';readonly selectable:boolean;
 readonly execution:'legacy_shaped'|'band_edge';readonly routineBand:string;readonly changeBand:string;
 readonly shareBps:number;readonly minimumBatchUsd:string;readonly retainedCapitalUsd:string;
 readonly capMode:'strict_realized'|'economic_cash_review';
}
export interface ContestTrialV1 {readonly id:string;readonly armId:string;readonly capitalUsd:string;readonly variantId:string}
export interface ContestFold {readonly id:string;readonly trainFromMs:number;readonly trainToMs:number;readonly validationFromMs:number;readonly validationToMs:number;readonly embargoMs:number}
export interface ContestContrast {
 readonly id:string;readonly left:string;readonly right:string;readonly group:'S'|'E'|'R';
 readonly metric:'timeWeightedReturnPct'|'userNetOutcomePct'|'maxDrawdownPct';readonly variantId:string;
 readonly primary:boolean;readonly minimumDifference:number;
}
export interface CapitalContestManifestV1 {
 readonly version:typeof CAPITAL_CONTEST_VERSION;readonly mode:'offline_development';readonly confirmatoryEligible:false;readonly liveExecutionPermitted:false;
 readonly supersedesManifestHash:string|null;readonly replay:CapitalReplaySpecV1;readonly scenarios:readonly ReplayVariant[];readonly dataHash:string;
 readonly candidates:readonly ContestCandidateV1[];readonly arms:readonly ContestArmV1[];readonly trials:readonly ContestTrialV1[];
 readonly operatingRequests:readonly {readonly capitalUsd:string;readonly intents:readonly FeasibilityIntentV1[]}[];
 readonly folds:readonly ContestFold[];readonly contrasts:readonly ContestContrast[];
 readonly primaryWeights:Readonly<Record<string,string>>;
 readonly inference:{readonly seed:number;readonly resamples:number;readonly meanBlockDays:number;readonly alpha:number;readonly minHistoryDays:number;readonly minEffectiveBlocks:number;readonly minTailReplications:number};
 readonly trialHistory:{readonly state:'complete'|'conservative-upper-bound'|'known-lower-bound';readonly registryHash:string|null;readonly count:number;readonly sharpeTrials:readonly number[];readonly evidenceRefs:readonly string[]};
 readonly selection:{readonly minObservations:number;readonly minActions:number;readonly maxPbo:number;readonly minDsr:number;readonly maxDrawdownPct:number;readonly partitions:number;readonly rollingDays:readonly number[];readonly minimumFoldExcessPct:number;readonly minimumWorstRollingReturnPct:number};
 readonly distributionObjective:{readonly maxSacrificePct:number;readonly maxFloorBreaches:number;readonly minimumReservedOrReceivedUsd:string};
 readonly resources:{readonly maxBaseCells:number;readonly maxPaths:number;readonly maxOutputBytes:number};
 readonly sourceRefs:readonly string[];
}
export interface ContestMembership {readonly assetId:string;readonly fromMs:number;readonly toMs:number;readonly observedAtMs:number;readonly eligible:boolean;readonly assurance:'scenario'|'observed'}
export interface ContestInputManifestV1 {readonly warmup:readonly ReplayMarketFrame[];readonly market:readonly ReplayMarketFrame[];readonly membership:readonly ContestMembership[];readonly availability?:readonly {readonly assetId:string;readonly endMs:number;readonly observedAtMs:number}[]|undefined}
export interface ContestDecisionEvidence {readonly decision:ReplayDecision;readonly bookHash:string;readonly historyHash:string;readonly reasons:readonly string[];readonly foldId:string|null;readonly fittedThroughMs:number|null}
export interface ContestCellV1 {readonly trial:ContestTrialV1;readonly result:ReplayCellResult;readonly decisions:readonly ContestDecisionEvidence[];readonly targetHash:string;readonly limitations:readonly string[];readonly saleConsequences:readonly ContestSaleConsequence[]}
export type ContestStatistic={readonly status:'available';readonly value:number}|{readonly status:'unavailable';readonly reasons:readonly string[]};
export interface ContestInterval {readonly id:string;readonly estimate:ContestStatistic;readonly lower:number|null;readonly upper:number|null;readonly reasons:readonly string[];readonly method:'paired-bonferroni-basic-bootstrap-v1';readonly familySize:number;readonly resamples:number}
export interface ContestPathV1 {readonly id:string;readonly index:number;readonly indices:readonly number[];readonly dataHash:string;readonly cellHashes:readonly string[];readonly differences:Readonly<Record<string,ContestStatistic>>;readonly status:'complete'|'unavailable'}
export interface ContestChoice {readonly candidateId:string|null;readonly status:'conditional_development_choice'|'none';readonly reasons:readonly string[];readonly diagnostics:Readonly<Record<string,ContestStatistic>>}
export interface ContestResultV1 {readonly version:typeof CAPITAL_CONTEST_VERSION;readonly id:string;readonly manifestHash:string;readonly confirmatoryEligible:false;readonly liveExecutionPermitted:false;readonly cellIds:readonly string[];readonly cellHashes:readonly string[];readonly pathIds:readonly string[];readonly intervals:readonly ContestInterval[];readonly choice:ContestChoice;readonly distributionChoices:readonly {readonly armId:string;readonly status:'meets_declared_objective'|'none';readonly reasons:readonly string[]}[];readonly limitations:readonly string[]}
export interface ContestSaleConsequence {readonly previewId:string;readonly assetId:string;readonly status:'hypothetical_full_exit'|'unavailable';readonly quantity:string;readonly notionalUsd:string|null;readonly modeledCostUsd:string|null;readonly realizedGainUsd:string|null;readonly cashAfterUsd:string|null;readonly residualQuantity:string|null;readonly evidenceRef:string|null;readonly reasonCodes:readonly string[];readonly fundsEligibility:false}
