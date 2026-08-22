import {
  findResearchPreRegistrationByHash,
  verifiedResearchStudyRuns,
  type Db,
  type StoredResearchStudyRun,
} from '@coqui/storage';

const DAY_MS = 86_400_000;

/**
 * The scoreboard's comparable track table (`docs/UI-UX.md` §2.3).
 *
 * Per-track metrics are persisted, but only inside `research_study_runs.result_json`
 * as an opaque hash-verified blob written by `runRegisteredNestedStudy`. This
 * parses that blob under a strict validator rather than trusting its shape:
 * every field is checked, and a row that fails validation is dropped rather
 * than rendered from partial data.
 *
 * Two properties are deliberate and load-bearing.
 *
 * **DSR and trial count are run-level, not per-track.** `HoldoutAdoptionResult`
 * carries one `dsr`/`trialCount`, describing the *selected candidate* only. Hold
 * and passive therefore report `null`. Copying the candidate's DSR onto a
 * benchmark row would attribute significance to a track that was never tested
 * for it — precisely the overclaim this project exists to avoid.
 *
 * **Sample length comes from the registered plan's holdout window**, not from an
 * equity series: `NestedChronologicalStudyResult` persists three `StrategyMetrics`
 * and no `equity` array, so there is nothing to count. When the plan cannot be
 * loaded the field is `null` rather than guessed.
 */

export type ScoreboardIssueCode =
  | 'storage_rejected'
  | 'no_verified_run'
  | 'unreadable_result';

export interface ScoreboardIssue {
  readonly path: readonly string[];
  readonly code: ScoreboardIssueCode;
}

export type ScoreboardResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ScoreboardIssue[] };

/** `selected` is the candidate the study chose; the others are its benchmarks. */
export type ScoreboardTrackId = 'selected' | 'hold' | 'passive';

export interface ScoreboardTrack {
  readonly trackId: ScoreboardTrackId;
  readonly afterCostReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly sortino: number | null;
  readonly sharpe: number | null;
  /** Non-null only for `selected`. A benchmark was never tested for significance. */
  readonly dsr: number | null;
  /** Non-null only for `selected`, and always an upper bound — see the trial registry. */
  readonly trialCount: number | null;
  readonly excessReturnVsHoldPct: number | null;
  readonly excessReturnVsPassivePct: number | null;
}

export interface ScoreboardView {
  readonly runId: string;
  readonly completedAtMs: number;
  readonly adopted: boolean;
  readonly tracks: readonly ScoreboardTrack[];
  /** Holdout length in whole days, from the registered plan. Null when unavailable. */
  readonly sampleDays: number | null;
  readonly datasetHash: string;
  readonly codeRevision: string;
  readonly runHash: string;
  /**
   * Literal `false` until an adopted study backs the defaults. P3's replacement
   * run was negative, so every parameter on this surface is a legacy default.
   */
  readonly parametersValidated: false;
}

function issue<T>(path: readonly string[], code: ScoreboardIssueCode): ScoreboardResult<T> {
  return { ok: false, issues: [{ path, code }] };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function probability(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

interface ParsedMetrics {
  readonly maxDrawdownPct: number;
  readonly sortino: number | null;
  readonly sharpe: number | null;
  readonly totalReturnPct: number;
}

/** `StrategyMetrics` is validated field by field; a partial object is rejected. */
function parseMetrics(value: unknown): ParsedMetrics | null {
  const metrics = record(value);
  if (metrics === null) return null;
  const maxDrawdownPct = finite(metrics['maxDrawdownPct']);
  const totalReturnPct = finite(metrics['totalReturnPct']);
  if (maxDrawdownPct === null || totalReturnPct === null) return null;
  return {
    maxDrawdownPct,
    totalReturnPct,
    // Nullable in the source type: an all-positive series has no downside
    // deviation, so Sortino is genuinely undefined rather than zero.
    sortino: finite(metrics['sortino']),
    sharpe: finite(metrics['sharpe']),
  };
}

interface ParsedHoldout {
  readonly adopted: boolean;
  readonly afterCostReturnPct: number;
  readonly excessReturnVsHoldPct: number;
  readonly excessReturnVsPassivePct: number;
  readonly selected: ParsedMetrics;
  readonly hold: ParsedMetrics;
  readonly passive: ParsedMetrics;
  readonly dsr: number | null;
  readonly trialCount: number | null;
}

function parseHoldout(resultJson: string): ParsedHoldout | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return null;
  }

  const result = record(parsed);
  const holdout = result === null ? null : record(result['holdout']);
  if (holdout === null) return null;

  const selected = parseMetrics(holdout['metrics']);
  const hold = parseMetrics(holdout['holdMetrics']);
  const passive = parseMetrics(holdout['passiveMetrics']);
  const afterCostReturnPct = finite(holdout['afterCostReturnPct']);
  const excessVsHold = finite(holdout['excessReturnVsHoldPct']);
  const excessVsPassive = finite(holdout['excessReturnVsPassivePct']);
  if (
    selected === null || hold === null || passive === null ||
    afterCostReturnPct === null || excessVsHold === null || excessVsPassive === null ||
    typeof holdout['adopted'] !== 'boolean'
  ) return null;

  const trialCount = holdout['trialCount'];
  return {
    adopted: holdout['adopted'],
    afterCostReturnPct,
    excessReturnVsHoldPct: excessVsHold,
    excessReturnVsPassivePct: excessVsPassive,
    selected,
    hold,
    passive,
    dsr: probability(holdout['dsr']),
    trialCount:
      typeof trialCount === 'number' && Number.isSafeInteger(trialCount) && trialCount > 0
        ? trialCount
        : null,
  };
}

/** Holdout length in whole days, read from the plan the run was registered against. */
function sampleDaysFor(run: StoredResearchStudyRun, database: Db): number | null {
  try {
    const stored = findResearchPreRegistrationByHash(run.preRegistrationHash, database);
    if (stored === null) return null;
    const plan = record(JSON.parse(stored.planJson));
    const validation = plan === null ? null : record(plan['validation']);
    const holdout = validation === null ? null : record(validation['holdout']);
    if (holdout === null) return null;
    const start = finite(holdout['startMs']);
    const end = finite(holdout['endExclusiveMs']);
    if (start === null || end === null || end <= start) return null;
    return Math.floor((end - start) / DAY_MS);
  } catch {
    return null;
  }
}

function tracksFrom(holdout: ParsedHoldout): readonly ScoreboardTrack[] {
  return Object.freeze([
    {
      trackId: 'selected',
      afterCostReturnPct: holdout.afterCostReturnPct,
      maxDrawdownPct: holdout.selected.maxDrawdownPct,
      sortino: holdout.selected.sortino,
      sharpe: holdout.selected.sharpe,
      dsr: holdout.dsr,
      trialCount: holdout.trialCount,
      excessReturnVsHoldPct: holdout.excessReturnVsHoldPct,
      excessReturnVsPassivePct: holdout.excessReturnVsPassivePct,
    },
    {
      trackId: 'hold',
      afterCostReturnPct: holdout.hold.totalReturnPct,
      maxDrawdownPct: holdout.hold.maxDrawdownPct,
      sortino: holdout.hold.sortino,
      sharpe: holdout.hold.sharpe,
      // A benchmark was never a candidate, so it has no search budget to deflate.
      dsr: null,
      trialCount: null,
      excessReturnVsHoldPct: null,
      excessReturnVsPassivePct: null,
    },
    {
      trackId: 'passive',
      afterCostReturnPct: holdout.passive.totalReturnPct,
      maxDrawdownPct: holdout.passive.maxDrawdownPct,
      sortino: holdout.passive.sortino,
      sharpe: holdout.passive.sharpe,
      dsr: null,
      trialCount: null,
      excessReturnVsHoldPct: null,
      excessReturnVsPassivePct: null,
    },
  ] satisfies ScoreboardTrack[]);
}

export interface ResearchScoreboardDependencies {
  readonly database: Db;
}

export class ResearchScoreboardService {
  readonly #database: Db;

  constructor(dependencies: ResearchScoreboardDependencies) {
    this.#database = dependencies.database;
  }

  /**
   * The most recent content-verified study run, as comparable track rows.
   *
   * `verifiedResearchStudyRuns` re-derives each row's hash and throws on
   * mismatch, so a tampered row fails the whole read rather than appearing on a
   * scoreboard as though it were sound.
   */
  latest(): ScoreboardResult<ScoreboardView> {
    let runs: readonly StoredResearchStudyRun[];
    try {
      runs = verifiedResearchStudyRuns(this.#database);
    } catch {
      return issue(['scoreboard'], 'storage_rejected');
    }

    const run = runs.at(-1);
    if (run === undefined) return issue(['scoreboard'], 'no_verified_run');

    const holdout = parseHoldout(run.resultJson);
    if (holdout === null) return issue(['scoreboard'], 'unreadable_result');

    return {
      ok: true,
      value: {
        runId: run.id,
        completedAtMs: run.completedAtMs,
        adopted: holdout.adopted,
        tracks: tracksFrom(holdout),
        sampleDays: sampleDaysFor(run, this.#database),
        datasetHash: run.datasetHash,
        codeRevision: run.codeRevision,
        runHash: run.runHash,
        parametersValidated: false,
      },
    };
  }
}
