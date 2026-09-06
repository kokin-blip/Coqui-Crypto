import {
  canonicalJson,
  instrumentKey,
  planAutoRebalance,
  sha256Hex,
  strategyDecisionId,
  type AllocationPolicy,
  type CanonicalJsonValue,
  type Clock,
  type DecisionEvidenceEventV1,
  type Holding,
  type StrategyDecisionV1,
} from '@coqui/core';
import {
  appendDecisionEvidenceEvent,
  appendWalletRunAudit,
  getStrategyDecision,
  getWalletDecisionRun,
  inTransaction,
  linkWalletDecisionRun,
  listPaperBalances,
  recoverInterruptedPaperOrders,
  saveStrategyDecision,
  saveWalletDecisionRun,
  type Db,
} from '@coqui/storage';

import { PaperExecutionService } from './execution-service.js';
import { resolveKillSwitch } from './kill-switch.js';
import type { PaperMarketData } from './oms.js';

/**
 * The paper decision loop, as a scheduler task.
 *
 * `WalletSchedulerService` already owns UTC cadence, leases, concurrency and an
 * injected clock, and until now had **no production caller**. This supplies the
 * task; the composition root supplies the wake-up.
 *
 * Every run records a `wallet_decision_run`, including runs that trade nothing.
 * That is deliberate and is what makes the forward-evidence counters honest: a
 * day the engine ran and correctly stood down is an *observed* day, while a day
 * it never ran is not. `docs/PLAN.md` P6 puts it as "never elapsed empty days".
 */

/**
 * This loop currently rebalances a saved allocation policy. It does not invoke
 * the Momentum + VolTarget implementation, so its durable identity must not
 * claim that it does.
 */
export const PAPER_ALLOCATION_REBALANCER_VERSION = 'allocation-policy-rebalancer-v1';

export type PaperRunStandDown =
  | 'kill_switch_engaged'
  | 'no_policy'
  | 'no_intents'
  | 'gates_refused'
  | 'pending_review'
  | 'execution_failed'
  | 'execution_unknown'
  | 'market_fetch_failed'
  | 'invalid_market_data'
  | 'market_alignment_failed'
  | 'insufficient_history'
  | 'stale_market_data'
  | 'stale_product_rules';

export type PaperDecisionPreparation =
  | {
      readonly ok: true;
      readonly datasetHash: string;
      readonly latestCompletedStartMs: number;
      readonly expectedCompletedStartMs: number;
      readonly ruleSnapshotHash: string;
    }
  | {
      readonly ok: false;
      readonly code: Exclude<PaperRunStandDown,
        | 'kill_switch_engaged' | 'no_policy' | 'no_intents' | 'gates_refused'
        | 'pending_review' | 'execution_failed' | 'execution_unknown'>;
      readonly datasetHash?: string;
      readonly latestCompletedStartMs?: number;
      readonly expectedCompletedStartMs?: number;
      readonly ruleSnapshotHash?: string;
      readonly rulesFresh?: boolean;
    };

export interface PaperRunSummary {
  readonly profileId: string;
  readonly runId: string;
  readonly strategyVersion: string;
  readonly scheduledForMs: number;
  readonly decidedAtMs: number;
  /** Null when the run traded; otherwise why it did not. */
  readonly standDown: PaperRunStandDown | null;
  readonly filledCount: number;
  readonly refusedCount: number;
  /** Exact paper balances before this decision; persisted with the run for replay-safe evidence. */
  readonly preDecisionBalances: readonly { readonly assetId: string; readonly quantity: string }[];
}

export interface PaperRunLoopDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly profileId: string;
  readonly market: PaperMarketData;
  /**
   * Injected rather than imported so the loop holds no cross-service import and
   * stays unit-testable without a portfolio or a price source.
   */
  readonly holdings: () => readonly Holding[];
  readonly policy: () => AllocationPolicy | null;
  /** Result of this tick's all-or-nothing decision-data and rule refresh. */
  readonly preparation: () => PaperDecisionPreparation;
  readonly historicalGrossEdgeLowerBoundPct: number;
  /** A verified immutable research snapshot, checked again at submission. */
  readonly evidenceVerified?: () => boolean;
  /** Append the post-decision daily valuation; missing days are never backfilled. */
  readonly captureEvidence?: (summary: PaperRunSummary) => Promise<void>;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
}

/** Deterministic per profile and slot, so a replayed tick is the same run. */
function runIdFor(profileId: string, scheduledForMs: number): string {
  return sha256Hex(`paper:${profileId}:${scheduledForMs}`);
}

function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value as CanonicalJsonValue));
}

function journal(
  database: Db,
  profileId: string,
  runId: string,
  at: number,
  kind: string,
  status: string,
  detail: Record<string, unknown>,
): void {
  appendWalletRunAudit(
    {
      id: sha256Hex(`${runId}:${kind}:${at}`),
      profileId,
      runId,
      at,
      kind,
      status,
      detailJson: JSON.stringify({ paperOnly: true, ...detail }),
    },
    database,
  );
}

/**
 * Run one paper decision.
 *
 * Exposed separately from the task so a deterministic multi-day harness can
 * drive it directly with a controlled clock, which is how the 7-day exit
 * criterion is verified in CI.
 */
export function runPaperDecision(
  dependencies: PaperRunLoopDependencies,
  scheduledForMs: number,
): PaperRunSummary {
  const { database, profileId } = dependencies;
  const decidedAtMs = dependencies.clock.nowMs();
  const runId = runIdFor(profileId, scheduledForMs);
  const decisionId = strategyDecisionId(profileId, scheduledForMs);
  let decisionCreatedAtMs = decidedAtMs;
  let storedDecisionHash: string | null = null;
  let planned: { readonly proposalId: string; readonly planHash: string } | null = null;
  let preDecisionBalances: PaperRunSummary['preDecisionBalances'] = listPaperBalances(
    profileId,
    database,
  ).map(({ assetId, quantity }) => Object.freeze({ assetId, quantity }));

  const terminalEvent = (
    standDown: PaperRunStandDown | null,
    filled: number,
    refused: number,
  ): DecisionEvidenceEventV1 => {
    const common = {
      schemaVersion: 1 as const,
      decisionId,
      profileId,
      sequence: planned === null ? 1 : 2,
      atMs: decisionCreatedAtMs,
    };
    if (standDown === 'no_intents') {
      return {
        ...common,
        kind: 'no_trade',
        detail: {
          reasonCode: 'no_intents',
          estimatedTradeUsd: null,
          minimumUsefulTradeUsd: null,
        },
      };
    }
    if (standDown === null) {
      if (planned === null) throw new Error('Filled execution is missing its durable plan.');
      return {
        ...common,
        kind: 'execution_filled',
        detail: { proposalId: planned.proposalId, filledCount: filled, refusedCount: refused },
      };
    }
    if (['gates_refused', 'execution_failed', 'execution_unknown'].includes(standDown)) {
      return {
        ...common,
        kind: 'execution_refused',
        detail: { proposalId: planned?.proposalId ?? null, reasonCode: standDown, refusedCount: refused },
      };
    }
    return { ...common, kind: 'stand_down', detail: { reasonCode: standDown } };
  };

  const finish = (standDown: PaperRunStandDown | null, filled = 0, refused = 0): PaperRunSummary => {
    if (storedDecisionHash === null) throw new Error('Paper outcome has no durable strategy decision.');
    // Evidence, compatibility summary and identity link advance atomically.
    inTransaction(database, () => {
      appendDecisionEvidenceEvent(terminalEvent(standDown, filled, refused), database);
      saveWalletDecisionRun({
        id: runId,
        profileId,
        scheduledFor: scheduledForMs,
        strategyVersion: PAPER_ALLOCATION_REBALANCER_VERSION,
        snapshotHash: storedDecisionHash!,
        snapshotJson: canonicalJson({
          decisionId,
          filled,
          preDecisionBalances,
          refused,
          standDown,
        }),
        status: 'completed',
        createdAt: decisionCreatedAtMs,
        updatedAt: decisionCreatedAtMs,
        error: null,
      }, database);
      linkWalletDecisionRun(runId, decisionId, database);
    });
    journal(database, profileId, runId, decisionCreatedAtMs, 'paper_run', 'completed', {
      standDown,
      filled,
      refused,
    });
    return {
      profileId,
      runId,
      strategyVersion: PAPER_ALLOCATION_REBALANCER_VERSION,
      scheduledForMs,
      decidedAtMs: decisionCreatedAtMs,
      standDown,
      filledCount: filled,
      refusedCount: refused,
      preDecisionBalances,
    };
  };

  // A slot decided once stays decided. The scheduler can fire the same slot
  // again after a lease expiry or a restart, and re-running would place a
  // second set of orders against a market that has since moved — and the
  // append-only journal would rightly refuse to rewrite its own record.
  const existing = getWalletDecisionRun(runId, database);
  if (existing !== null && existing.status === 'completed') {
    const snapshot = JSON.parse(existing.snapshotJson) as {
      standDown: PaperRunStandDown | null;
      filled: number;
      refused: number;
      preDecisionBalances?: readonly { readonly assetId: string; readonly quantity: string }[];
    };
    preDecisionBalances = snapshot.preDecisionBalances?.map((balance) => Object.freeze(balance)) ?? [];
    return {
      profileId,
      runId,
      strategyVersion: PAPER_ALLOCATION_REBALANCER_VERSION,
      scheduledForMs,
      decidedAtMs: existing.createdAt,
      standDown: snapshot.standDown,
      filledCount: snapshot.filled,
      refusedCount: snapshot.refused,
      preDecisionBalances,
    };
  }

  const persistDecision = (
    policy: AllocationPolicy | null,
    holdings: readonly Holding[] | null,
    preparation: PaperDecisionPreparation | null = null,
  ): void => {
    const existingDecision = getStrategyDecision(decisionId, database);
    const createdAtMs = existingDecision?.decision.createdAtMs ?? decidedAtMs;
    decisionCreatedAtMs = createdAtMs;
    const targetRows = (policy?.targets ?? [])
      .map((target) => ({ assetId: instrumentKey(target.instrument), weight: target.weight }))
      .sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
    const targetExposure = targetRows.reduce((sum, target) => sum + target.weight, 0);
    const holdingRows = holdings?.map((holding) => ({
      assetId: instrumentKey(holding.asset.instrument),
      priceUsd: holding.priceUsd,
      quantity: holding.quantity,
      valueUsd: holding.valueUsd,
    })).sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0) ?? null;
    const portfolioHash = holdingRows === null ? null : hashCanonical(holdingRows);
    const configHash = hashCanonical(policy === null ? null : {
      rebalanceBandPct: policy.rebalanceBandPct,
      targets: targetRows,
    });
    const preparationFailure = preparation !== null && !preparation.ok
      ? preparation.code
      : null;
    const decision: StrategyDecisionV1 = {
      schemaVersion: 1,
      decisionId,
      profileId,
      runId,
      scheduledForMs,
      strategy: {
        id: 'allocation-policy-rebalancer',
        version: PAPER_ALLOCATION_REBALANCER_VERSION,
        configHash,
      },
      market: {
        snapshotHash: preparation?.datasetHash ?? null,
        asOfMs: preparation?.latestCompletedStartMs ?? null,
        expectedAsOfMs: preparation?.expectedCompletedStartMs ?? null,
        freshness: preparationFailure === 'stale_market_data'
          ? 'stale'
          : preparation?.datasetHash !== undefined ? 'fresh' : 'unavailable',
        refreshResult: preparation === null
          ? 'not_requested'
          : preparation.ok ? 'succeeded' : preparation.code,
        ruleSnapshotHash: preparation?.ruleSnapshotHash ?? null,
        rulesFresh: preparation === null
          ? false
          : preparation.ok ? true : preparation.rulesFresh ?? false,
      },
      portfolio: {
        snapshotHash: portfolioHash,
        version: holdingRows === null ? null : 'legacy-profile-holdings-v1',
        source: holdingRows === null ? 'unavailable' : 'profile_holdings',
      },
      targets: targetRows,
      cashWeight: policy === null ? null : Math.max(0, 1 - targetExposure),
      exposure: policy === null ? null : Math.min(1, targetExposure),
      historyStatus: 'unavailable',
      createdAtMs,
    };
    inTransaction(database, () => {
      const stored = saveStrategyDecision(decision, database);
      storedDecisionHash = stored.contentHash;
      appendDecisionEvidenceEvent({
        schemaVersion: 1,
        decisionId,
        profileId,
        sequence: 0,
        kind: 'strategy_evaluated',
        atMs: createdAtMs,
        detail: { decisionHash: stored.contentHash },
      }, database);
    });
  };

  const killSwitch = resolveKillSwitch(profileId, database);
  if (killSwitch.engaged) {
    // Invariant 5: the kill switch halts paper too. Recorded as a completed
    // observation, because the engine did run and correctly declined to act.
    journal(database, profileId, runId, decidedAtMs, 'kill_switch', 'halted', {
      reason: killSwitch.reason,
    });
    persistDecision(null, null);
    return finish('kill_switch_engaged');
  }

  const policy = dependencies.policy();
  if (policy === null) {
    persistDecision(null, null);
    return finish('no_policy');
  }

  const preparation = dependencies.preparation();
  if (!preparation.ok) {
    persistDecision(policy, null, preparation);
    return finish(preparation.code);
  }

  const holdings = dependencies.holdings();
  persistDecision(policy, holdings, preparation);
  const intents = planAutoRebalance(holdings, policy, decidedAtMs);
  if (intents.length === 0) return finish('no_intents');

  planned = {
    proposalId: sha256Hex(`paper-proposal:${runId}:1`),
    planHash: hashCanonical(intents.map((intent) => ({
      amountUsd: intent.amountUsd,
      assetId: instrumentKey(intent.asset.instrument),
      origin: intent.origin,
      reason: intent.reason,
      side: intent.side,
      urgency: intent.urgency,
    }))),
  };
  appendDecisionEvidenceEvent({
    schemaVersion: 1,
    decisionId,
    profileId,
    sequence: 1,
    kind: 'execution_planned',
    atMs: decisionCreatedAtMs,
    detail: { planId: planned.proposalId, planHash: planned.planHash, intentCount: intents.length },
  }, database);

  const execution = new PaperExecutionService({
    database,
    profileId,
    nowMs: () => dependencies.clock.nowMs(),
    market: dependencies.market,
    state: () => ({
      holdings: dependencies.holdings(),
      killSwitchEngaged: resolveKillSwitch(profileId, database).engaged,
      evidenceVerified: dependencies.evidenceVerified?.() ?? false,
      historicalGrossEdgeLowerBoundPct: dependencies.historicalGrossEdgeLowerBoundPct,
    }),
    ...(dependencies.onUnexpectedError === undefined
      ? {}
      : {
          onUnexpectedError: dependencies.onUnexpectedError,
        }),
  });
  const outcome = execution.prepare({
    proposalId: planned.proposalId,
    runId,
    revision: 1,
    intents,
  });

  journal(database, profileId, runId, decidedAtMs, 'execution', outcome.status, {
    proposalId: outcome.proposalId,
    proposalHash: outcome.proposalHash,
    reasonCode: outcome.reasonCode,
    filled: outcome.filledCount,
    refused: outcome.refusedCount,
  });

  if (outcome.status === 'pending') return finish('pending_review');
  if (outcome.status === 'unknown') return finish('execution_unknown', 0, outcome.refusedCount);
  if (outcome.status === 'failed') return finish('execution_failed', 0, outcome.refusedCount);
  if (outcome.status === 'blocked') {
    return finish(
      outcome.reasonCode === 'kill_switch_engaged' ? 'kill_switch_engaged' : 'gates_refused',
      0,
      outcome.refusedCount,
    );
  }
  return finish(null, outcome.filledCount, outcome.refusedCount);
}

/**
 * Sweep orders left non-terminal by a crash, before the first tick.
 *
 * `recoverInterruptedPaperOrders` classifies each one: fully filled becomes
 * `filled`, untouched becomes `cancelled`, and anything ambiguous becomes
 * `unknown` rather than a guess — invariant 15 applied to a restart.
 */
export function recoverPaperOrdersAtStartup(
  dependencies: Pick<PaperRunLoopDependencies, 'database' | 'clock' | 'profileId'>,
): { readonly reconciled: number; readonly blocked: number } {
  return recoverInterruptedPaperOrders(
    dependencies.profileId,
    dependencies.clock.nowMs(),
    dependencies.database,
  );
}

export interface PaperSchedulerTask {
  readonly profileId: string;
  readonly cadenceMs: number;
  readonly utcOffsetMs?: number;
  execute(context: {
    readonly scheduledForMs: number;
  }): Promise<{ readonly status: 'completed' | 'degraded'; readonly reasonCode?: string }>;
}

/**
 * Wrap the decision as a `WalletSchedulerTask`.
 *
 * A stand-down reports `completed`, not `degraded`. The scheduler outcome
 * describes whether the *task* ran, and the scheduler's own validation forbids
 * a reason code on `completed` — the reason a run traded nothing belongs in the
 * journal, which is where a user or the reconciliation harness will look.
 */
export function createPaperRunLoopTask(
  dependencies: PaperRunLoopDependencies,
  cadenceMs = 86_400_000,
  utcOffsetMs = 0,
): PaperSchedulerTask {
  return {
    profileId: dependencies.profileId,
    cadenceMs,
    utcOffsetMs,
    async execute(context) {
      try {
        const summary = runPaperDecision(dependencies, context.scheduledForMs);
        await dependencies.captureEvidence?.(summary);
        return { status: 'completed' };
      } catch (error) {
        dependencies.onUnexpectedError?.('paper_run', error);
        return { status: 'degraded', reasonCode: 'paper_run_failed' };
      }
    },
  };
}
