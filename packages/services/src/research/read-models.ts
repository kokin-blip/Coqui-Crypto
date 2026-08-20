import {
  getResearchJob,
  listResearchJobs,
  verifiedResearchStudyRuns,
  type Db,
  type StoredResearchJob,
  type StoredResearchStudyRun,
} from '@coqui/storage';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_LIMIT = 200;

/**
 * Stable reason vocabulary for the research surfaces.
 *
 * `error` columns on research rows hold whatever a worker threw, which can
 * carry a file path, a dataset fragment, or a stack. Invariant 3 keeps that off
 * every surface, so a view never forwards the stored string — it maps to one of
 * these codes and the raw text stays in the database for local diagnosis.
 */
export type ResearchReadIssueCode =
  | 'invalid_id'
  | 'invalid_limit'
  | 'unknown_job'
  | 'storage_rejected';

export interface ResearchReadIssue {
  readonly path: readonly string[];
  readonly code: ResearchReadIssueCode;
}

export type ResearchReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ResearchReadIssue[] };

/** Why a job is not showing a result. Never the worker's own message. */
export type ResearchFailureReason =
  | 'none'
  | 'cancelled'
  | 'deadline_exceeded'
  | 'worker_failed'
  | 'interrupted'
  | 'integrity_mismatch';

/**
 * The immutable identities that make a study result citable: what was planned,
 * what data it ran on, what code produced it, and what it cost. A scoreboard
 * figure without these is an unsourced claim.
 */
export interface ResearchRunView {
  readonly id: string;
  readonly preRegistrationHash: string;
  readonly datasetHash: string;
  readonly costProfileHash: string;
  readonly codeRevision: string;
  readonly selectedCandidateId: string;
  readonly adopted: boolean;
  readonly completedAtMs: number;
  readonly runHash: string;
}

export interface ResearchJobSummaryView {
  readonly id: string;
  readonly kind: StoredResearchJob['kind'];
  readonly status: StoredResearchJob['status'];
  readonly createdAtMs: number;
  readonly startedAtMs: number | null;
  readonly completedAtMs: number | null;
  readonly attemptCount: number;
  readonly failureReason: ResearchFailureReason;
}

export interface ResearchJobDetailView extends ResearchJobSummaryView {
  readonly formatVersion: number;
  readonly snapshotHash: string | null;
  readonly resultHash: string | null;
  readonly deadlineAtMs: number | null;
  readonly hasSnapshot: boolean;
  readonly hasResult: boolean;
}

function issue<T>(path: readonly string[], code: ResearchReadIssueCode): ResearchReadResult<T> {
  return { ok: false, issues: [{ path, code }] };
}

function hashOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && HASH_PATTERN.test(value) ? value : null;
}

/**
 * Collapse a stored job onto the stable vocabulary.
 *
 * A stored `errorCode` is only trusted when it is one of the known reasons; an
 * unrecognised code is reported as `worker_failed` rather than passed through,
 * because an unknown string on this path is indistinguishable from leaked
 * worker text.
 */
function failureReason(job: StoredResearchJob): ResearchFailureReason {
  if (job.status === 'cancelled') return 'cancelled';
  if (job.status === 'completed') return 'none';
  if (job.status === 'failed') {
    // `integrity_mismatch` is raised by the repository itself, not a worker: the
    // stored payload no longer hashes to its recorded digest. It must stay
    // distinguishable from a strategy that failed, because it means the row is
    // corrupt rather than the study unsuccessful.
    if (job.errorCode === 'integrity_mismatch') return 'integrity_mismatch';
    if (job.errorCode === 'deadline_exceeded') return 'deadline_exceeded';
    if (job.errorCode === 'interrupted') return 'interrupted';
    return 'worker_failed';
  }
  return 'none';
}

function summarize(job: StoredResearchJob): ResearchJobSummaryView {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    createdAtMs: job.createdAt,
    startedAtMs: job.startedAt,
    completedAtMs: job.completedAt,
    attemptCount: Number.isSafeInteger(job.attemptCount) ? (job.attemptCount as number) : 0,
    failureReason: failureReason(job),
  };
}

function runView(run: StoredResearchStudyRun): ResearchRunView {
  return {
    id: run.id,
    preRegistrationHash: run.preRegistrationHash,
    datasetHash: run.datasetHash,
    costProfileHash: run.costProfileHash,
    codeRevision: run.codeRevision,
    selectedCandidateId: run.selectedCandidateId,
    adopted: run.adopted,
    completedAtMs: run.completedAtMs,
    runHash: run.runHash,
  };
}

export interface ResearchReadModelDependencies {
  readonly database: Db;
}

/**
 * Bounded read models over persisted research state.
 *
 * Three properties are load-bearing. Study rows are content-verified on read
 * rather than trusted, and a row that fails verification fails the whole read
 * closed rather than being quietly omitted. Payload bodies — manifests,
 * snapshots, worker results — are reported as present or absent but never
 * returned, because these views feed list surfaces that have no use for a
 * multi-megabyte blob. And no stored error string crosses the boundary.
 */
export class ResearchReadModelService {
  readonly #database: Db;

  constructor(dependencies: ResearchReadModelDependencies) {
    this.#database = dependencies.database;
  }

  /**
   * Immutable plan, dataset, code, cost, and outcome identities per study run.
   *
   * `verifiedResearchStudyRuns` re-derives each row's hash and throws when a
   * row no longer matches. That throw is deliberately not softened into a
   * partial list: a study whose provenance cannot be verified must not be
   * citable, so the whole read fails closed with a stable code.
   */
  runs(): ResearchReadResult<readonly ResearchRunView[]> {
    let stored: readonly StoredResearchStudyRun[];
    try {
      stored = verifiedResearchStudyRuns(this.#database);
    } catch {
      return issue(['runs'], 'storage_rejected');
    }
    return { ok: true, value: stored.map(runView) };
  }

  /** Bounded job summaries with stable status and reason codes. */
  jobs(limit = 100): ResearchReadResult<readonly ResearchJobSummaryView[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
      return issue(['jobs', 'limit'], 'invalid_limit');
    }
    let stored: readonly StoredResearchJob[];
    try {
      stored = listResearchJobs(this.#database, limit);
    } catch {
      return issue(['jobs'], 'storage_rejected');
    }
    return { ok: true, value: stored.map(summarize) };
  }

  /** Scoped immutable job evidence. Presence of a payload, never the payload. */
  job(id: string): ResearchReadResult<ResearchJobDetailView> {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      return issue(['job', 'id'], 'invalid_id');
    }

    let stored: StoredResearchJob | null;
    try {
      stored = getResearchJob(id, this.#database);
    } catch {
      return issue(['job'], 'storage_rejected');
    }
    if (stored === null) return issue(['job'], 'unknown_job');

    return {
      ok: true,
      value: {
        ...summarize(stored),
        formatVersion: Number.isSafeInteger(stored.formatVersion)
          ? (stored.formatVersion as number)
          : 1,
        snapshotHash: hashOrNull(stored.snapshotHash),
        resultHash: hashOrNull(stored.resultHash),
        deadlineAtMs: typeof stored.deadlineAt === 'number' ? stored.deadlineAt : null,
        hasSnapshot: stored.snapshotJson !== null,
        hasResult: stored.resultJson !== null,
      },
    };
  }
}
