import {
  canonicalJson,
  DEFAULT_MOMENTUM_CONFIG,
  DEFAULT_VOL_TARGET_CONFIG,
  instrumentKey,
  planAutoRebalance,
  sha256Hex,
  strategyDecisionId,
  trendVolTargets,
  type AllocationPolicy,
  type DecisionEvidenceEventV1,
  type Holding,
} from '@coqui/core';
import {
  appendDecisionEvidenceEvent,
  getWalletDecisionRun,
  inTransaction,
  getPaperBookOrigin,
  initializePaperBook,
  linkWalletDecisionRun,
  listDecisionEvidenceEvents,
  listPaperBalances,
  listSubmittedPaperExecutions,
  recoverInterruptedPaperOrders,
  savePaperCampaignPlanV2,
  saveWalletDecisionRun,
} from '@coqui/storage';

import { PaperExecutionService } from './execution-service.js';
import { recordPaperDecision, type PaperStrategyIdentity } from './decision-recorder.js';
import { paperCostModelHash } from './venue.js';
import { resolveKillSwitch } from './kill-switch.js';
import {
  hashCanonical,
  journal,
  normalizedMix,
  openingSnapshot,
  paperHoldings,
  PAPER_ALLOCATION_REBALANCER_VERSION,
  PAPER_TRENDVOL_VERSION,
  runIdFor,
  type PaperDecisionPreparation,
  type PaperRunLoopDependencies,
  type PaperRunStandDown,
  type PaperRunSummary,
} from './runtime-model.js';

export {
  PAPER_ALLOCATION_REBALANCER_VERSION,
  PAPER_TRENDVOL_VERSION,
  type PaperDecisionPreparation,
  type PaperRunLoopDependencies,
  type PaperRunStandDown,
  type PaperRunSummary,
} from './runtime-model.js';

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
  let runtimeStrategyVersion = PAPER_ALLOCATION_REBALANCER_VERSION;
  let storedDecisionHash: string | null = null;
  let strategyConfigHash: string | null = null;
  let planned: { readonly proposalId: string; readonly planHash: string } | null = null;
  let submission: { readonly proposalHash: string; readonly orderIds: readonly string[] } | null = null;
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
    if (standDown === 'pending_settlement' && planned !== null && submission !== null) {
      return {
        ...common,
        kind: 'execution_submitted',
        detail: {
          proposalId: planned.proposalId,
          proposalHash: submission.proposalHash,
          orderIds: submission.orderIds,
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

  const finish = (
    standDown: PaperRunStandDown | null,
    filled = 0,
    refused = 0,
    submitted = 0,
  ): PaperRunSummary => {
    if (storedDecisionHash === null) throw new Error('Paper outcome has no durable strategy decision.');
    // Evidence, compatibility summary and identity link advance atomically.
    inTransaction(database, () => {
      appendDecisionEvidenceEvent(terminalEvent(standDown, filled, refused), database);
      saveWalletDecisionRun({
        id: runId,
        profileId,
        scheduledFor: scheduledForMs,
        strategyVersion: runtimeStrategyVersion,
        snapshotHash: storedDecisionHash!,
        snapshotJson: canonicalJson({
          decisionId,
          filled,
          submitted,
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
      strategyVersion: runtimeStrategyVersion,
      scheduledForMs,
      decidedAtMs: decisionCreatedAtMs,
      standDown,
      filledCount: filled,
      submittedCount: submitted,
      refusedCount: refused,
      preDecisionBalances,
    };
  };

  const persistDecision = (
    policy: AllocationPolicy | null,
    holdings: readonly Holding[] | null,
    preparation: PaperDecisionPreparation | null = null,
    strategy: PaperStrategyIdentity = {
      id: 'allocation-policy-rebalancer',
      version: PAPER_ALLOCATION_REBALANCER_VERSION,
      historyStatus: 'unavailable',
      facts: null,
      portfolioSource: 'profile_holdings',
    },
  ): void => {
    const recorded = recordPaperDecision({
      database, profileId, runId, decisionId, scheduledForMs, decidedAtMs,
      policy, holdings, preparation, strategy,
    });
    decisionCreatedAtMs = recorded.createdAtMs;
    storedDecisionHash = recorded.contentHash;
    strategyConfigHash = recorded.configHash;
  };

  let executionHoldings: readonly Holding[] = [];
  const execution = new PaperExecutionService({
    database,
    profileId,
    nowMs: () => dependencies.clock.nowMs(),
    market: dependencies.market,
    ...(dependencies.executionOwnerId === undefined
      ? {}
      : { executionOwnerId: dependencies.executionOwnerId }),
    state: () => ({
      holdings: executionHoldings,
      killSwitchEngaged: resolveKillSwitch(profileId, database).engaged,
      evidenceVerified: dependencies.evidenceVerified?.() ?? false,
      historicalGrossEdgeLowerBoundPct: dependencies.historicalGrossEdgeLowerBoundPct,
    }),
    ...(dependencies.onUnexpectedError === undefined
      ? {}
      : { onUnexpectedError: dependencies.onUnexpectedError }),
  });

  const preparation = dependencies.preparation();
  if (preparation.ok) {
    const settlement = execution.settlePending();
    const settledByDecision = new Map<string, typeof settlement.outcomes[number][]>();
    for (const outcome of settlement.outcomes) {
      const grouped = settledByDecision.get(outcome.decisionId) ?? [];
      grouped.push(outcome);
      settledByDecision.set(outcome.decisionId, grouped);
    }
    for (const [settledDecisionId, outcomes] of settledByDecision) {
      const sequence = listDecisionEvidenceEvents(
        settledDecisionId,
        profileId,
        database,
      ).length;
      const submitted = listDecisionEvidenceEvents(settledDecisionId, profileId, database)
        .find((event) => event.kind === 'execution_submitted');
      const filled = outcomes.filter((outcome) => outcome.disposition === 'filled');
      if (filled.length > 0 && submitted?.kind === 'execution_submitted') {
        appendDecisionEvidenceEvent({
          schemaVersion: 1,
          decisionId: settledDecisionId,
          profileId,
          sequence,
          kind: 'execution_filled',
          atMs: Math.max(...filled.map((outcome) => outcome.atMs)),
          detail: {
            proposalId: submitted.detail.proposalId,
            filledCount: filled.length,
            refusedCount: outcomes.length - filled.length,
          },
        }, database);
      }
      let nextSequence = sequence + (filled.length > 0 ? 1 : 0);
      for (const outcome of outcomes.filter((item) => item.disposition === 'expired')) {
        appendDecisionEvidenceEvent({
          schemaVersion: 1,
          decisionId: settledDecisionId,
          profileId,
          sequence: nextSequence,
          kind: 'recovery',
          atMs: outcome.atMs,
          detail: { orderId: outcome.orderId, disposition: 'expired' },
        }, database);
        nextSequence += 1;
      }
    }
    preDecisionBalances = listPaperBalances(profileId, database)
      .map(({ assetId, quantity }) => Object.freeze({ assetId, quantity }));
  }

  // A decided slot stays decided, but refresh-time settlement still runs first
  // so a restart on the same scheduler slot can reconcile its durable order.
  const existing = getWalletDecisionRun(runId, database);
  if (existing !== null && existing.status === 'completed') {
    const snapshot = JSON.parse(existing.snapshotJson) as {
      standDown: PaperRunStandDown | null;
      filled: number;
      submitted?: number;
      refused: number;
      preDecisionBalances?: readonly { readonly assetId: string; readonly quantity: string }[];
    };
    preDecisionBalances = snapshot.preDecisionBalances?.map((balance) => Object.freeze(balance)) ?? [];
    return {
      profileId,
      runId,
      strategyVersion: existing.strategyVersion,
      scheduledForMs,
      decidedAtMs: existing.createdAt,
      standDown: snapshot.standDown,
      filledCount: snapshot.filled,
      submittedCount: snapshot.submitted ?? 0,
      refusedCount: snapshot.refused,
      preDecisionBalances,
    };
  }

  const killSwitch = resolveKillSwitch(profileId, database);
  if (killSwitch.engaged) {
    // Invariant 5: the kill switch halts paper too. Recorded as a completed
    // observation, because the engine did run and correctly declined to act.
    journal(database, profileId, runId, decidedAtMs, 'kill_switch', 'halted', {
      reason: killSwitch.reason,
    });
    persistDecision(null, null, preparation);
    return finish('kill_switch_engaged');
  }

  const policy = dependencies.policy();
  if (policy === null) {
    persistDecision(null, null, preparation);
    return finish('no_policy');
  }

  if (!preparation.ok) {
    persistDecision(policy, null, preparation);
    return finish(preparation.code);
  }

  if (getPaperBookOrigin(profileId, database) === null) {
    const source = openingSnapshot(profileId, dependencies.holdings(), decidedAtMs);
    if (typeof source === 'string') {
      persistDecision(policy, null, preparation);
      return finish(source);
    }
    try {
      initializePaperBook(source, database);
    } catch (error) {
      if (error instanceof Error && error.message.includes('explicit reset')) {
        persistDecision(policy, null, preparation);
        return finish('paper_book_requires_reset');
      }
      throw error;
    }
  }

  let holdings: readonly Holding[];
  try {
    holdings = paperHoldings(profileId, policy, preparation, database);
  } catch (error) {
    if (error instanceof Error && error.message === 'paper_book_incomplete') {
      persistDecision(policy, null, preparation);
      return finish('paper_book_incomplete');
    }
    throw error;
  }
  executionHoldings = holdings;
  const baseTargets = policy.targets.map((target) => ({
    assetId: instrumentKey(target.instrument), weight: target.weight,
  }));
  const trend = trendVolTargets(
    baseTargets,
    preparation.dataset.closesById,
    normalizedMix(policy, preparation.dataset),
  );
  const instrumentById = new Map(policy.targets.map((target) =>
    [instrumentKey(target.instrument), target.instrument]));
  const targetPolicy: AllocationPolicy = {
    rebalanceBandPct: policy.rebalanceBandPct,
    targets: trend.targets.map((target) => ({
      instrument: instrumentById.get(target.assetId)!, weight: target.weight,
    })),
  };
  persistDecision(targetPolicy, holdings, preparation, {
    id: 'trendvol',
    version: PAPER_TRENDVOL_VERSION,
    historyStatus: trend.historyStatus,
    facts: {
      momentum: trend.momentum.stats,
      realizedVolPct: trend.volatility.realizedVolPct,
      belowTrend: trend.volatility.belowTrend,
    },
    portfolioSource: 'paper_ledger',
    configMaterial: {
      basePolicy: policy,
      momentum: DEFAULT_MOMENTUM_CONFIG,
      volTarget: DEFAULT_VOL_TARGET_CONFIG,
    },
  });
  runtimeStrategyVersion = PAPER_TRENDVOL_VERSION;
  const codeHash = sha256Hex('trendvol-paper-v1:shared-core-targets:pending-next-open');
  const costModelHash = paperCostModelHash();
  savePaperCampaignPlanV2({
    schemaVersion: 2,
    id: sha256Hex(`paper-campaign-v2:${profileId}:${PAPER_TRENDVOL_VERSION}:${strategyConfigHash}`),
    profileId,
    strategyId: 'trendvol',
    strategyVersion: PAPER_TRENDVOL_VERSION,
    configHash: strategyConfigHash!,
    codeHash,
    evidenceSchemaVersion: 1,
    costModelHash,
    prospectiveStartMs: scheduledForMs,
    createdAtMs: decisionCreatedAtMs,
  }, database);
  const intents = planAutoRebalance(holdings, targetPolicy, decidedAtMs)
    .sort((left, right) => left.side !== right.side
      ? left.side === 'sell' ? -1 : 1
      : instrumentKey(left.asset.instrument) < instrumentKey(right.asset.instrument) ? -1 : 1);
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

  const outcome = execution.prepare({
    proposalId: planned.proposalId,
    runId,
    revision: 1,
    intents,
    pending: {
      decisionId,
      requiredExecutionBarStartMs: preparation.latestCompletedStartMs + 86_400_000,
      costModelHash,
    },
  });

  journal(database, profileId, runId, decidedAtMs, 'execution', outcome.status, {
    proposalId: outcome.proposalId,
    proposalHash: outcome.proposalHash,
    reasonCode: outcome.reasonCode,
    filled: outcome.filledCount,
    refused: outcome.refusedCount,
  });

  if (outcome.status === 'pending') return finish('pending_review');
  if (outcome.status === 'submitted') {
    submission = {
      proposalHash: outcome.proposalHash,
      orderIds: listSubmittedPaperExecutions(profileId, database)
        .filter((item) => item.decisionId === decisionId)
        .map((item) => item.orderId),
    };
    return finish('pending_settlement', 0, outcome.refusedCount, submission.orderIds.length);
  }
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
  readonly catchUpPolicy: 'recompute_current';
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
    catchUpPolicy: 'recompute_current',
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
