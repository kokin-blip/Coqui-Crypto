import {
  canExecute,
  totalTradeCostBps,
  DEFAULT_TRADE_COST_CONFIG,
  type AutoTradeMode,
  type Clock,
} from '@coqui/core';
import {
  getSetting,
  getWalletRiskState,
  listCoinbaseBalanceDiscrepancies,
  listWalletSchedules,
  type Db,
} from '@coqui/storage';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const MAX_DISCREPANCIES = 1_000;

export type StatusRailIssueCode = 'invalid_profile_id' | 'clock_unavailable' | 'storage_rejected';

export interface StatusRailIssue {
  readonly path: readonly string[];
  readonly code: StatusRailIssueCode;
}

export type StatusRailResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly StatusRailIssue[] };

/**
 * Reconciliation state for the rail.
 *
 * The rail slot that `docs/UI-UX.md` §2.1 calls "last successful reconciliation"
 * has to be able to say when the last run *did not* leave things settled.
 * Reporting only the timestamp would answer the rail's own question — "is
 * anything wrong right now?" — with "no" while exceptions sit unresolved.
 *
 * `unresolvedCount` is a count, never a severity. A discrepancy is immutable
 * evidence requiring user resolution (invariant 12), not a blocking condition:
 * nothing in the execution path consults it.
 */
export interface ReconciliationStatus {
  readonly lastRunAtMs: number | null;
  readonly unresolvedCount: number;
  readonly neverRun: boolean;
}

export interface StatusRailView {
  readonly profileId: string;
  /** Always `'paper'` in this build; `canExecute` permits nothing else. */
  readonly mode: AutoTradeMode;
  readonly executionPermitted: boolean;
  readonly killSwitchEngaged: boolean;
  readonly riskStage: string | null;
  /** Scheduled wallet jobs currently holding a lease. */
  readonly activeJobCount: number;
  readonly scheduledJobCount: number;
  readonly reconciliation: ReconciliationStatus;
  /** Total round-trip friction in basis points, from the one shared cost model. */
  readonly costModelBps: number;
  readonly assessedAtMs: number;
}

export interface StatusRailDependencies {
  readonly database: Db;
  readonly clock: Clock;
}

function issue<T>(path: readonly string[], code: StatusRailIssueCode): StatusRailResult<T> {
  return { ok: false, issues: [{ path, code }] };
}

function epochFromSetting(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The decision-critical state `docs/UI-UX.md` §1 requires to stay continuously
 * visible, composed for the rail that every screen reuses.
 *
 * It reads repositories directly rather than other services. Composing the
 * wallet, risk, scheduler and reconciliation services would need four
 * cross-service imports and the `architecture/service-import-limit` rule caps a
 * service at two — deliberately, so that cross-cutting composition stays
 * visible instead of accumulating inside whichever service needed it first.
 */
export class StatusRailService {
  readonly #database: Db;
  readonly #clock: Clock;

  constructor(dependencies: StatusRailDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
  }

  status(profileId: string): StatusRailResult<StatusRailView> {
    if (typeof profileId !== 'string' || !PROFILE_ID.test(profileId)) {
      return issue(['statusRail', 'profileId'], 'invalid_profile_id');
    }

    let assessedAtMs: number;
    try {
      assessedAtMs = this.#clock.nowMs();
      if (!Number.isSafeInteger(assessedAtMs) || assessedAtMs <= 0) {
        return issue(['statusRail'], 'clock_unavailable');
      }
    } catch {
      return issue(['statusRail'], 'clock_unavailable');
    }

    try {
      const risk = getWalletRiskState(profileId, this.#database);
      const schedules = listWalletSchedules(MAX_DISCREPANCIES, this.#database);
      const discrepancies = listCoinbaseBalanceDiscrepancies(this.#database, MAX_DISCREPANCIES);
      const lastRunAtMs = epochFromSetting(
        getSetting('coinbase.last_sync_at', this.#database),
      );

      // Invariant 1: paper is the only mode this build can execute in, and the
      // rail states it rather than leaving the user to infer it.
      const mode: AutoTradeMode = 'paper';
      const killSwitchEngaged = risk?.hardStopped ?? false;

      return {
        ok: true,
        value: {
          profileId,
          mode,
          executionPermitted: canExecute(mode, killSwitchEngaged),
          killSwitchEngaged,
          riskStage: risk?.stage ?? null,
          // A lease that has expired is not a running job. Counting by owner
          // alone would report a crashed worker as still working.
          activeJobCount: schedules.filter(
            (schedule) =>
              schedule.state === 'running' &&
              schedule.ownerId !== null &&
              (schedule.leasedUntil ?? 0) > assessedAtMs,
          ).length,
          scheduledJobCount: schedules.filter((schedule) => schedule.enabled).length,
          reconciliation: {
            lastRunAtMs,
            unresolvedCount: discrepancies.length,
            neverRun: lastRunAtMs === null,
          },
          costModelBps: totalTradeCostBps(DEFAULT_TRADE_COST_CONFIG),
          assessedAtMs,
        },
      };
    } catch {
      return issue(['statusRail'], 'storage_rejected');
    }
  }
}
