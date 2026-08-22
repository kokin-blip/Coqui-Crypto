import {
  planAutoRebalance,
  sha256Hex,
  type AllocationPolicy,
  type Clock,
  type Holding,
} from '@coqui/core';
import {
  appendWalletRunAudit,
  getWalletDecisionRun,
  recoverInterruptedPaperOrders,
  saveWalletDecisionRun,
  type Db,
} from '@coqui/storage';

import { isApproved, runExecutionGates } from './execution-gate.js';
import { resolveKillSwitch } from './kill-switch.js';
import { PaperOmsService, type PaperMarketData } from './oms.js';

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

const STRATEGY_VERSION = 'trendvol-legacy-unvalidated';

export type PaperRunStandDown =
  | 'kill_switch_engaged'
  | 'no_policy'
  | 'no_intents'
  | 'gates_refused';

export interface PaperRunSummary {
  readonly profileId: string;
  readonly runId: string;
  readonly scheduledForMs: number;
  readonly decidedAtMs: number;
  /** Null when the run traded; otherwise why it did not. */
  readonly standDown: PaperRunStandDown | null;
  readonly filledCount: number;
  readonly refusedCount: number;
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
  readonly historicalNetEdgeEstimatePct: number;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
}

/** Deterministic per profile and slot, so a replayed tick is the same run. */
function runIdFor(profileId: string, scheduledForMs: number): string {
  return sha256Hex(`paper:${profileId}:${scheduledForMs}`);
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

  const finish = (standDown: PaperRunStandDown | null, filled = 0, refused = 0): PaperRunSummary => {
    // The decision run is written whatever happened. A stand-down is a decision.
    saveWalletDecisionRun(
      {
        id: runId,
        profileId,
        scheduledFor: scheduledForMs,
        strategyVersion: STRATEGY_VERSION,
        snapshotHash: sha256Hex(`${runId}:${standDown ?? 'traded'}:${filled}`),
        snapshotJson: JSON.stringify({ standDown, filled, refused }),
        status: 'completed',
        createdAt: decidedAtMs,
        updatedAt: decidedAtMs,
        error: null,
      },
      database,
    );
    journal(database, profileId, runId, decidedAtMs, 'paper_run', 'completed', {
      standDown,
      filled,
      refused,
    });
    return {
      profileId,
      runId,
      scheduledForMs,
      decidedAtMs,
      standDown,
      filledCount: filled,
      refusedCount: refused,
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
    };
    return {
      profileId,
      runId,
      scheduledForMs,
      decidedAtMs: existing.createdAt,
      standDown: snapshot.standDown,
      filledCount: snapshot.filled,
      refusedCount: snapshot.refused,
    };
  }

  const killSwitch = resolveKillSwitch(profileId, database);
  if (killSwitch.engaged) {
    // Invariant 5: the kill switch halts paper too. Recorded as a completed
    // observation, because the engine did run and correctly declined to act.
    journal(database, profileId, runId, decidedAtMs, 'kill_switch', 'halted', {
      reason: killSwitch.reason,
    });
    return finish('kill_switch_engaged');
  }

  const policy = dependencies.policy();
  if (policy === null) return finish('no_policy');

  const holdings = dependencies.holdings();
  const intents = planAutoRebalance(holdings, policy, decidedAtMs);
  if (intents.length === 0) return finish('no_intents');

  const approval = runExecutionGates({
    profileId,
    runId,
    nowMs: decidedAtMs,
    mode: 'paper',
    killSwitchEngaged: false,
    intents,
    holdings,
    historicalNetEdgeEstimatePct: dependencies.historicalNetEdgeEstimatePct,
  });

  if (!isApproved(approval)) {
    journal(database, profileId, runId, decidedAtMs, 'gates', 'refused', {
      code: approval.code,
      gate: approval.gate,
      skipped: approval.skipped.length,
    });
    return finish('gates_refused');
  }

  const oms = new PaperOmsService({
    database,
    clock: dependencies.clock,
    market: dependencies.market,
    ...(dependencies.onUnexpectedError === undefined
      ? {}
      : {
          onUnexpectedError: (productId: string, error: unknown) =>
            dependencies.onUnexpectedError?.(`oms:${productId}`, error),
        }),
  });
  const result = oms.execute(approval);

  journal(database, profileId, runId, decidedAtMs, 'orders', 'placed', {
    filled: result.filledCount,
    refused: result.refusedCount,
    orders: result.orders.map((order) => ({
      productId: order.productId,
      side: order.side,
      state: order.finalState,
      // A stable issue code, never a raw message (invariant 3).
      issue: order.issue?.code ?? null,
    })),
  });

  return finish(null, result.filledCount, result.refusedCount);
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
        runPaperDecision(dependencies, context.scheduledForMs);
        return { status: 'completed' };
      } catch (error) {
        dependencies.onUnexpectedError?.('paper_run', error);
        return { status: 'degraded', reasonCode: 'paper_run_failed' };
      }
    },
  };
}
