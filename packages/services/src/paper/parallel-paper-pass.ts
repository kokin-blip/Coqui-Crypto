import type { RequestDeadline } from '@coqui/adapters';
import type { Clock } from '@coqui/core';
import { appendParallelEvent, createParallelEventReader, parallelExperimentStatus,
  type Db, type ParallelPaperExperiment } from '@coqui/storage';
import { parallelAttemptsResolved } from './parallel-paper-recovery.js';
import { parallelPaperFailureDetail } from './parallel-paper-utils.js';

/** Per-pass journal view and diagnostics. This object never changes activation state. */
export class ParallelPaperPass {
  readonly events: ReturnType<typeof createParallelEventReader>;
  phase = 'credentials';
  readonly #started: number;
  readonly #startedAtMs: number;
  readonly #budgetMs: number | null;
  readonly #initialAttempts = new Set<string>();
  #initialized = false;
  constructor(readonly profileId: string, readonly db: Db, readonly clock: Clock, readonly deadline?: RequestDeadline) {
    this.#started = performance.now(); this.#startedAtMs = clock.nowMs();
    this.#budgetMs = deadline?.remainingMs() ?? null;
    const read = createParallelEventReader(profileId, db);
    this.events = (id) => {
      const events = read(id);
      if (!this.#initialized) {
        for (const event of events) if (event.kind === 'submit_attempt') this.#initialAttempts.add(event.id);
        this.#initialized = true;
      }
      return events;
    };
  }
  failure(error: unknown, fallback: string) {
    const detail = parallelPaperFailureDetail(error, fallback);
    if (detail.reason !== 'deadline_exceeded') return detail;
    return { ...detail, operation: !detail.operation || detail.operation === 'unknown' ? this.phase : detail.operation,
      elapsedMs: detail.elapsedMs ?? performance.now() - this.#started,
      budgetMs: detail.budgetMs ?? this.#budgetMs,
      remainingMs: detail.remainingMs ?? this.deadline?.remainingMs() ?? null };
  }
  defer(experiment: ParallelPaperExperiment, error: unknown): boolean {
    const detail = this.failure(error, 'paper_execution_unknown');
    if (detail.reason !== 'deadline_exceeded') return false;
    const events = this.events(experiment.id);
    let resolved: boolean;
    try { resolved = parallelAttemptsResolved(events); } catch { return false; }
    if (parallelExperimentStatus(events) !== 'active' || !resolved ||
        events.some(event => event.kind === 'submit_attempt' && !this.#initialAttempts.has(event.id))) return false;
    const at = this.clock.nowMs();
    appendParallelEvent({ experimentId: experiment.id, profileId: this.profileId, kind: 'pass_deferred',
      key: `pass-deferred:${at}:${events.length}`, at, detail: { ...detail,
        operation: detail.operation ?? this.phase, elapsedMs: performance.now() - this.#started,
        remainingMs: this.deadline?.remainingMs() ?? null, retryAtMs: Math.max(at, this.#startedAtMs + 60_000) } }, this.db);
    return true;
  }
  complete(experiment: ParallelPaperExperiment): void {
    const events = this.events(experiment.id);
    const state = parallelExperimentStatus(events);
    if (state === 'stopped') return;
    const at = this.clock.nowMs();
    appendParallelEvent({ experimentId: experiment.id, profileId: this.profileId, kind: 'pass_complete',
      key: `pass-complete:${at}:${events.length}`, at, detail: { operation: state === 'paused' ? 'resume_preflight' : 'paper_pass' } }, this.db);
  }
}
