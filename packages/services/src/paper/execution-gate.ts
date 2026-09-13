import {
  applyAutoTradeGuardrails,
  applyProfitabilityGate,
  canExecute,
  resolveRiskControlState,
  DEFAULT_AUTO_TRADE_GUARDRAILS,
  DEFAULT_VENUE_COST_PROFILE,
  type AutoTradeGuardrails,
  type AutoTradeMode,
  type ExecutionIntent,
  type Holding,
  type MarketQualitySnapshot,
  type PaperAdmissionModeV1,
  type ProfitabilityAssessmentV1,
  type RiskControlInput,
  type RiskControlState,
  type SkippedAutoTrade,
  type VenueCostProfile,
} from '@coqui/core';

/**
 * The only path to an executable order.
 *
 * `ARCHITECTURE.md` §6 specifies a chain of gates and states plainly: "Every
 * order path traverses all four gates. There is no bypass." Until now that was
 * a sentence in a document — all five gate functions existed as tested pure
 * code and **not one of them was called from anywhere**.
 *
 * This makes the sentence true by construction rather than by discipline.
 * `ApprovedExecution` carries a brand keyed to a symbol this module does not
 * export, so no other file can build one, and the OMS accepts nothing else.
 * Skipping a gate is not a code-review question; it does not typecheck.
 */

/**
 * A real, module-private symbol — not a `declare const`.
 *
 * A type-only brand would exist for the compiler and vanish at runtime, so an
 * object literal cast to `ApprovedExecution` would be indistinguishable from a
 * genuine approval to anything that inspects the value. This symbol is never
 * exported, so no other module can produce a key for it.
 */
const approvalBrand: unique symbol = Symbol('coqui.paper.approvedExecution');

export type GateName =
  | 'guardrails'
  | 'profitability'
  | 'risk_control'
  | 'execution_permission';

/**
 * Proof that every gate ran and permitted execution.
 *
 * Only `runExecutionGates` can produce one. Construct it nowhere else.
 */
export interface ApprovedExecution {
  readonly [approvalBrand]: true;
  readonly profileId: string;
  readonly runId: string;
  readonly approvedAtMs: number;
  readonly intents: readonly ExecutionIntent[];
  readonly gatesPassed: readonly GateName[];
  /** Always `'paper'`; `canExecute` permits nothing else in this build. */
  readonly mode: AutoTradeMode & 'paper';
  readonly riskState: RiskControlState;
  readonly skipped: readonly SkippedAutoTrade[];
  readonly admissionMode: PaperAdmissionModeV1;
  readonly campaignId: string | null;
  readonly paperBookRef: Readonly<{ kind: 'profile' } | { kind: 'exploratory_campaign'; campaignId: string }>;
  readonly profitabilityAssessment: ProfitabilityAssessmentV1;
  readonly evidenceEligibility: Readonly<{
    validation: boolean;
    promotion: boolean;
    liveExecution: false;
  }>;
}

export type ExecutionRefusalCode =
  | 'kill_switch_engaged'
  | 'execution_not_permitted'
  | 'risk_hard_stop'
  | 'no_intents'
  | 'all_intents_filtered';

export interface ExecutionRefusal {
  readonly refused: true;
  readonly code: ExecutionRefusalCode;
  /** The gate that stopped it, so a surface can explain which rule applied. */
  readonly gate: GateName;
  readonly skipped: readonly SkippedAutoTrade[];
  readonly riskState: RiskControlState;
}

export type ExecutionGateOutcome = ApprovedExecution | ExecutionRefusal;

export function isApproved(outcome: ExecutionGateOutcome): outcome is ApprovedExecution {
  return !('refused' in outcome);
}

export interface ExecutionGateInput {
  readonly profileId: string;
  readonly runId: string;
  readonly nowMs: number;
  readonly mode: AutoTradeMode;
  /** True when either the risk ladder hard-stopped or a safety stop is active. */
  readonly killSwitchEngaged: boolean;
  readonly intents: readonly ExecutionIntent[];
  readonly holdings: readonly Holding[];
  /**
   * Optional, and defaulted to the shared profile. Invariant 14: every
   * backtest, sweep, paper fill and preview reads the *same* venue profile —
   * the predecessor's defect was a sweep passing 10bps against an 85bps app
   * default. Overriding this is for tests that are specifically about cost.
   */
  readonly costProfile?: VenueCostProfile;
  readonly admissionMode?: PaperAdmissionModeV1;
  readonly campaignId?: string | null;
  readonly historicalGrossEdgeLowerBoundPct: number | null;
  readonly guardrails?: AutoTradeGuardrails;
  readonly riskInput?: RiskControlInput;
  readonly marketQuality?: MarketQualitySnapshot | null;
}

/**
 * Run the chain in `ARCHITECTURE.md` §6 order.
 *
 * One ordering note, because the document is circular on this point. §6 lists
 * `resolveRiskControlState` fourth, after the guardrails — but the guardrails
 * consume `blockReason`, `maxTurnoverPct` and `maxTradeCount`, which the risk
 * state produces. The state is therefore *computed* first (it depends only on
 * equity history and market data, never on intents, so this cannot smuggle
 * information backwards) while its *effects* apply exactly where §6 places
 * them. Nothing is skipped and nothing is reordered in substance.
 */
export function runExecutionGates(input: ExecutionGateInput): ExecutionGateOutcome {
  const admissionMode = input.admissionMode ?? 'validated';
  if (admissionMode === 'exploratory' && !input.campaignId) {
    throw new TypeError('Exploratory execution requires a campaign identity.');
  }
  const riskState = resolveRiskControlState(input.riskInput ?? {});

  // Gate 0 — the kill switch precedes everything. Invariant 5 makes it global,
  // and it halts paper too, not only a hypothetical live path.
  if (input.killSwitchEngaged) {
    return {
      refused: true,
      code: 'kill_switch_engaged',
      gate: 'execution_permission',
      skipped: [],
      riskState,
    };
  }

  // A hard stop is the risk ladder's own refusal and scales exposure to zero.
  if (riskState.stage === 'hard_stop' || riskState.exposureScale <= 0) {
    return {
      refused: true,
      code: 'risk_hard_stop',
      gate: 'risk_control',
      skipped: [],
      riskState,
    };
  }

  if (input.intents.length === 0) {
    return { refused: true, code: 'no_intents', gate: 'guardrails', skipped: [], riskState };
  }

  // Gate 1 — guardrails, taking their caps from the resolved risk state so a
  // cautious or defensive stage tightens them rather than being advisory.
  const guardrails: AutoTradeGuardrails = {
    ...(input.guardrails ?? DEFAULT_AUTO_TRADE_GUARDRAILS),
    maxTurnoverPct: riskState.maxTurnoverPct,
    maxTrades: riskState.maxTradeCount,
    ...(riskState.blockReason === null ? {} : { blockReason: riskState.blockReason }),
  };
  const guarded = applyAutoTradeGuardrails(input.intents, input.holdings, guardrails);
  if (guarded.intents.length === 0) {
    return {
      refused: true,
      code: 'all_intents_filtered',
      gate: 'guardrails',
      skipped: Object.freeze([...guarded.skippedTrades]),
      riskState,
    };
  }

  // Gate 2 — profitability. Expected edge must clear the cost model with room.
  const profitabilityInput = {
    asOfMs: input.nowMs,
    riskState,
    ...(input.marketQuality === undefined ? {} : { marketQuality: input.marketQuality }),
  };
  const profitable = input.historicalGrossEdgeLowerBoundPct === null
    ? { intents: [] as ExecutionIntent[], skippedTrades: [] as SkippedAutoTrade[], checks: [] }
    : applyProfitabilityGate(
        [...guarded.intents],
        input.costProfile ?? DEFAULT_VENUE_COST_PROFILE,
        input.historicalGrossEdgeLowerBoundPct,
        profitabilityInput,
      );

  const costProfile = input.costProfile ?? DEFAULT_VENUE_COST_PROFILE;
  const venueFeeBps = costProfile.preferredLiquidity === 'maker'
    ? costProfile.makerFeeBps
    : costProfile.takerFeeBps;
  const estimatedCostUsd = guarded.intents.reduce((total, intent) => {
    const notional = Number(intent.amountUsd);
    return total + notional * (venueFeeBps + costProfile.spreadBps + costProfile.slippageBps) / 10_000;
  }, 0);
  const requiredEdgeUsd = estimatedCostUsd * costProfile.profitBufferMultiple;
  const profitabilityAssessment: ProfitabilityAssessmentV1 = input.historicalGrossEdgeLowerBoundPct === null
    ? Object.freeze({
        status: 'unavailable', historicalGrossEdgeLowerBoundPct: null,
        estimatedCostUsd, requiredEdgeUsd, reason: 'no_applicable_validated_edge',
      })
    : Object.freeze({
        status: 'assessed',
        historicalGrossEdgeLowerBoundPct: input.historicalGrossEdgeLowerBoundPct,
        estimatedCostUsd,
        requiredEdgeUsd,
        outcome: profitable.intents.length === guarded.intents.length ? 'passed' : 'would_refuse',
      });

  const enforceProfitability = admissionMode === 'validated';
  const approvedIntents = enforceProfitability ? profitable.intents : guarded.intents;
  const skipped = Object.freeze([
    ...guarded.skippedTrades,
    ...(enforceProfitability ? profitable.skippedTrades : []),
  ]);

  if (approvedIntents.length === 0) {
    return {
      refused: true,
      code: 'all_intents_filtered',
      gate: 'profitability',
      skipped,
      riskState,
    };
  }

  // Gate 3 — execution permission. Invariant 1: paper only, never live.
  if (!canExecute(input.mode, input.killSwitchEngaged)) {
    return {
      refused: true,
      code: 'execution_not_permitted',
      gate: 'execution_permission',
      skipped,
      riskState,
    };
  }

  return Object.freeze({
    [approvalBrand]: true,
    profileId: input.profileId,
    runId: input.runId,
    approvedAtMs: input.nowMs,
    intents: Object.freeze([...approvedIntents]),
    gatesPassed: Object.freeze([
      'guardrails',
      ...(enforceProfitability ? ['profitability' as const] : []),
      'risk_control',
      'execution_permission',
    ] as const),
    // `canExecute` returned true, which it does only for 'paper'.
    mode: 'paper',
    riskState,
    skipped,
    admissionMode,
    campaignId: input.campaignId ?? null,
    paperBookRef: admissionMode === 'exploratory'
      ? Object.freeze({ kind: 'exploratory_campaign' as const, campaignId: input.campaignId! })
      : Object.freeze({ kind: 'profile' as const }),
    profitabilityAssessment,
    evidenceEligibility: Object.freeze({
      validation: admissionMode === 'validated',
      promotion: admissionMode === 'validated',
      liveExecution: false as const,
    }),
  }) as ApprovedExecution;
}
