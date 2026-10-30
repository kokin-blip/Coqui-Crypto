import { createIsolatedRequestDeadline, withinDeadline, type RequestDeadline, type createAlpacaPaperClient } from '@coqui/adapters';
import { hourlySlotAt, type Clock } from '@coqui/core';
import { appendRemediationEvidence, inTransaction, listRemediationEvidence, getAuthoritativeHost, latestParallelExperiment, listParallelEvents, listStudyInstances, parallelExperimentStatus, type Db } from '@coqui/storage';
import { collectParallelHourlyShadowSafely, hourlyShadowStatus } from './parallel-hourly-shadow.js';
import { parallelSafeFailureReason } from './parallel-paper-utils.js';
import { parallelDecision } from './parallel-signal.js';
import type { PaperDecisionPreparation } from './runtime-model.js';

type ReadClient = Pick<ReturnType<typeof createAlpacaPaperClient>, 'account' | 'positions' | 'asset' | 'latestCryptoQuotes'>;
export interface HourlyShadowDependencies {
  readonly profileId: string; readonly hostId: string; readonly hostKind?: 'desktop' | 'headless';
  readonly database: Db; readonly clock: Clock;
  refresh(nowMs: number, deadline: RequestDeadline): Promise<PaperDecisionPreparation>;
  readClient(deadline: RequestDeadline): Promise<ReadClient>;
  killSwitchEngaged(): boolean;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
}

/** Independent virtual research lane. Its broker port exposes no submit/cancel methods. */
export class HourlyShadowService {
  #suspended = false;
  #generation = 0;
  #pass: Promise<void> | null = null;
  #deadline: RequestDeadline | null = null;
  constructor(readonly input: HourlyShadowDependencies) {}
  suspend(): void { this.#suspended = true; this.#generation++; this.#deadline?.dispose(); }
  resume(): void { this.#suspended = false; }
  tick(): Promise<void> {
    if (this.#pass) return this.#pass;
    if (this.#suspended) return Promise.resolve();
    this.#pass = this.#tick().catch(() => {
      // Provider failures are represented by the collector; cancellation is intentionally silent.
    }).finally(() => { this.#pass = null; });
    return this.#pass;
  }
  async #tick(): Promise<void> {
    const { input } = this, db = input.database, profile = input.profileId, now = () => input.clock.nowMs();
    const startedAtMs = now(), slot = hourlySlotAt(startedAtMs);
    if (slot === null || input.killSwitchEngaged()) return;
    const experiment = latestParallelExperiment(profile, db);
    if (!experiment || parallelExperimentStatus(listParallelEvents(experiment.id, profile, db)) === 'stopped') return;
    const status = hourlyShadowStatus(profile, db, startedAtMs);
    const completedThisHour = status.lastSlotMs !== null && Math.floor(status.lastSlotMs / 3_600_000) * 3_600_000 === slot;
    if (status.registrationState !== 'collecting' || completedThisHour || !status.studyInstanceId) return;
    const authority = getAuthoritativeHost(profile, db), generation = this.#generation;
    const deadline = createIsolatedRequestDeadline(now, 10_000, slot + 900_000);
    this.#deadline = deadline;
    const check = () => {
      deadline.check();
      const current = getAuthoritativeHost(profile, db);
      if (this.#suspended || generation !== this.#generation || input.killSwitchEngaged() ||
          current?.hostId !== authority?.hostId || current?.status !== authority?.status ||
          current?.fencingGeneration !== authority?.fencingGeneration ||
          current?.status === 'relinquished' ||
          (current?.status === 'active' && current.hostId !== input.hostId) ||
          (input.hostKind === 'headless' && (current?.status !== 'active' || current.hostId !== input.hostId)) ||
          latestParallelExperiment(profile, db)?.id !== experiment.id ||
          parallelExperimentStatus(listParallelEvents(experiment.id, profile, db)) === 'stopped' ||
          listStudyInstances(profile, status.version, db).at(-1)?.id !== status.studyInstanceId)
        throw new Error('stale_hourly_authority');
    };
    try {
      check();
      const [preparation, read] = await withinDeadline(Promise.all([
        input.refresh(startedAtMs, deadline), input.readClient(deadline),
      ]), deadline);
      check();
      if (!preparation.ok) throw new Error(preparation.code);
      const account = await withinDeadline(read.account(), deadline);
      check();
      if (account.id !== experiment.alpacaAccountId || account.currency !== 'USD') throw new Error('alpaca_account_changed');
      const decision = parallelDecision(preparation.dataset, experiment.anchor);
      if (decision.day !== new Date(slot - 86_400_000).toISOString().slice(0, 10)) throw new Error('stale_market_data');
      await withinDeadline(collectParallelHourlyShadowSafely({ profileId: profile, experimentId: experiment.id,
        db, nowMs: now(), now, beforeAppend: check, datasetHash: preparation.datasetHash, decision, read }), deadline);
    } catch (error) {
      // Record a bounded preparation failure only while this run still owns the study.
      try {
        check();
        const reason = parallelSafeFailureReason(error, 'hourly_shadow_unavailable');
        inTransaction(db, () => {
          check();
          const key = `${slot}:${reason}`;
          if (!listRemediationEvidence(profile, status.studyInstanceId!, 'failure', db).some(row => row.key === key))
            appendRemediationEvidence({ profileId: profile, namespace: status.studyInstanceId!, kind: 'failure', key,
              atMs: now(), body: { reason, slotMs: slot } }, db);
        });
      } catch { /* Stale or cancelled runs must not append, even a failure. */ }
    } finally { deadline.dispose(); if (this.#deadline === deadline) this.#deadline = null; }
  }
}
