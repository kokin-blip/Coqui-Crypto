import { connectionEligible, getProfileConnectionV2, getConnectionAccountSnapshotV2 } from '@coqui/storage';
import { Decimal } from 'decimal.js';

import { createAlpacaPaperClient, createAlpacaPaperTradeStream, createRequestDeadline, childRequestDeadline, AlpacaPaperError, withinDeadline, type AlpacaPaperCredentials, type AlpacaPaperTradeUpdate, type SecretStore, type RequestDeadline } from '@coqui/adapters';
import { instrumentKey, sha256Hex, type Clock } from '@coqui/core';
import {
  appendParallelEvent, countParallelEvents, getLatestConnectionAccountSnapshotV2, getSetting,
  latestParallelExperiment, listParallelEvents, listProfileConnectionsV2,
  parallelExperimentStatus, saveParallelExperiment, type Db, type ParallelPaperEvent,
  type ParallelPaperExperiment,
} from '@coqui/storage';

import { settleParallelLocal } from './parallel-paper-local.js';
import { ParallelPaperPass } from './parallel-paper-pass.js';
import { collectExecutionRemediationShadow } from './execution-remediation-shadow.js';
import { finalizeParallelSlots } from './parallel-paper-slots.js';
import { activeParallelEvents, supersedeUnsubmittedParallelPlans } from './parallel-paper-plans.js';
import { parallelPaperSummary } from './parallel-paper-summary.js';
import { parallelExecutionClaim, observedParallelClient } from './parallel-execution-safety.js';
import { PARALLEL_INSTRUMENTS, PARALLEL_TRENDVOL_VERSION,
  parallelAnchor, parallelDecision } from './parallel-signal.js';
import { recordParallelMark } from './parallel-paper-mark.js';
import { parallelAttemptsResolved, validateParallelBroker, prepareParallelPass } from './parallel-paper-recovery.js';
import { reconcilePaperPositionEvidence } from './parallel-paper-minor-recovery.js';
import { dayAfter } from './parallel-paper-activity.js';
import { reconcileParallelPaper } from './parallel-paper-reconciliation.js';
import { collectParallelHourlyShadowSafely } from './parallel-hourly-shadow.js';
import { recordFourHourExecutionObservation } from './parallel-execution-observation.js';
import { executeParallelDaily } from './parallel-paper-daily.js';
import { executeParallelIntraday } from './parallel-paper-intraday.js';
import type { MlSignalSnapshot } from './parallel-ml-worker.js';
import { readParallelMlSignal } from './parallel-ml-status.js';
import { ParallelBudgetError, ParallelReconciliationError, eventFor, money, parallelPaperFailureDetail, parallelSafeFailureReason } from './parallel-paper-utils.js';
import type { PaperDecisionPreparation } from './runtime-model.js';

const ASSET_IDS = PARALLEL_INSTRUMENTS.map(instrumentKey);
const DAY_MS = 86_400_000, CUTOFF_MS = 15 * 60_000;
type Client = ReturnType<typeof createAlpacaPaperClient>;

export interface ParallelPaperDependencies {
  readonly profileId: string;
  readonly hostId?: string;
  readonly hostKind?: 'desktop' | 'headless';
  readonly database: Db;
  readonly clock: Clock;
  readonly secrets?: SecretStore;
  readonly preparation: () => PaperDecisionPreparation;
  readonly refreshFor: (nowMs: number, deadline?: RequestDeadline) => Promise<PaperDecisionPreparation>;
  readonly clientFactory?: (credentials: AlpacaPaperCredentials) => Client;
  readonly killSwitchEngaged: () => boolean;
  readonly mlSignal?: () => MlSignalSnapshot | null;
}

export class ParallelPaperService {
  readonly #input: ParallelPaperDependencies;
  readonly #clientFactory: (credentials: AlpacaPaperCredentials) => Client;
  #lastCheckAtMs: number | null = null;
  #checking = false;
  #pass: ParallelPaperPass | undefined;
  #suspended = false;
  #deadline: RequestDeadline | undefined;
  #claim: ReturnType<typeof parallelExecutionClaim> | undefined;
  #tradeStream: ReturnType<typeof createAlpacaPaperTradeStream> | undefined;
  #tradeStreamKey: string | undefined;
  #tradeStreamStatus: 'connecting' | 'listening' | 'unavailable' = 'unavailable';

  constructor(input: ParallelPaperDependencies) {
    this.#input = input;
    this.#clientFactory = input.clientFactory ?? createAlpacaPaperClient;
    const existing = latestParallelExperiment(input.profileId, input.database);
    if (existing && parallelExperimentStatus(listParallelEvents(existing.id, input.profileId, input.database)) === 'active') {
      this.#append(existing, 'paused', `startup-pause:${countParallelEvents(existing.id, input.profileId, input.database)}`,
        { reason: 'runtime_restart', reconciliationRequired: true, manualResumeRequired: true });
    }
  }

  #events(experiment: ParallelPaperExperiment): readonly ParallelPaperEvent[] {
    return this.#pass?.events(experiment.id) ?? listParallelEvents(experiment.id, this.#input.profileId, this.#input.database);
  }

  #append(experiment: ParallelPaperExperiment, kind: string, key: string, detail: Record<string, unknown>): void {
    if (kind === 'paused' && detail['reason'] !== 'user_action') {
      const state = this.#events(experiment).findLast((event) => ['paused', 'resumed', 'started', 'stopped'].includes(event.kind));
      if (state?.kind === 'paused' && state.detail['reason'] === 'user_action') kind = 'reconciliation_error';
    }
    appendParallelEvent({ experimentId: experiment.id, profileId: this.#input.profileId,
      kind, key, at: this.#input.clock.nowMs(), detail }, this.#input.database);
  }

  async #client(): Promise<Client> {
    const startedAtMs = this.#input.clock.nowMs(), started = performance.now(), budgetMs = this.#deadline?.remainingMs() ?? null;
    if (this.#pass) this.#pass.phase = 'credentials';
    try { return await this.#readClient(); }
    catch (error) {
      this.#tradeStream?.close(); this.#tradeStream = undefined; this.#tradeStreamKey = undefined;
      const experiment = latestParallelExperiment(this.#input.profileId, this.#input.database);
      if (experiment) this.#append(experiment, 'readiness', `credentials:${startedAtMs}:${this.#events(experiment).length}`,
        { operation: 'credentials', status: 'unavailable', startedAtMs, observedAtMs: this.#input.clock.nowMs(),
          durationMs: performance.now()-started, budgetMs, remainingMs: this.#deadline?.remainingMs() ?? null, reason: parallelSafeFailureReason(error, 'credentials_unavailable') });
      throw error;
    }
  }

  async #readClient(): Promise<Client> {
    if (this.#input.secrets === undefined) throw new Error('secret_store_unavailable');
    const stored = await withinDeadline(this.#input.secrets.read('alpaca-paper-credentials', this.#input.profileId), this.#deadline);
    if (!stored.ok) throw new Error(`secret_store_${stored.code}`);
    if (stored.value === null) throw new Error('credentials_unavailable');
    let parsed: unknown;
    try { parsed = JSON.parse(stored.value); } catch { throw new Error('credentials_corrupt'); }
    if (typeof parsed !== 'object' || parsed === null || !('keyId' in parsed) || !('secretKey' in parsed) ||
        typeof parsed.keyId !== 'string' || typeof parsed.secretKey !== 'string') throw new Error('credentials_unavailable');
    const credentials = { keyId: parsed.keyId, secretKey: parsed.secretKey };
    const experiment = latestParallelExperiment(this.#input.profileId, this.#input.database);
    if (experiment && !this.#input.clientFactory && !this.#suspended) {
      const streamKey = sha256Hex(`${experiment.id}:${credentials.keyId}:${credentials.secretKey}`);
      if (this.#tradeStreamKey !== streamKey) {
        this.#tradeStream?.close(); this.#tradeStreamKey = streamKey;
        this.#tradeStream = createAlpacaPaperTradeStream({ credentials,
          onUpdate: (update) => this.recordTradeUpdate(experiment.id, update),
          onStatus: (status) => {
            this.#tradeStreamStatus = status; if (parallelExperimentStatus(this.#events(experiment)) === 'stopped') return;
            this.#append(experiment, 'readiness', `trade-stream:${this.#events(experiment).length}`,
              { operation: 'trade_stream', status, observedAtMs: this.#input.clock.nowMs() });
          } });
      }
    }
    const readKey = String(experiment ? this.#events(experiment).length : 0);
    let attemptSequence = 0;
    const client = this.#input.clientFactory ? this.#clientFactory(credentials) : createAlpacaPaperClient(credentials, undefined, this.#deadline,
      (attempt) => { if (experiment) this.#append(experiment, 'broker_read_attempt',
        `read-attempt:${readKey}:${attemptSequence++}`, { ...attempt, observedAtMs: this.#input.clock.nowMs() }); });
    if (experiment) this.#append(experiment, 'readiness', `credentials:${this.#input.clock.nowMs()}:${this.#events(experiment).length}`,
      { operation: 'credentials', status: 'validated', observedAtMs: this.#input.clock.nowMs() });
    return observedParallelClient(client, () => this.#input.clock.nowMs(), (kind, key, detail) => {
      if (experiment) this.#append(experiment, kind, key, detail);
    }, this.#deadline, String(experiment ? this.#events(experiment).length : 0));
  }

  async start(commandId: string, smokeVerified: boolean): Promise<{ ok: true; experiment: ParallelPaperExperiment } | { ok: false; code: string }> {
    if (!smokeVerified) return { ok: false, code: 'paper_smoke_verification_required' };
    const current = latestParallelExperiment(this.#input.profileId, this.#input.database);
    if (current !== null && parallelExperimentStatus(this.#events(current)) !== 'stopped') {
      return { ok: false, code: 'experiment_already_active' };
    }
    if (this.#input.killSwitchEngaged()) return { ok: false, code: 'kill_switch_engaged' };
    const coinbase = listProfileConnectionsV2(this.#input.profileId, this.#input.database)
      .filter((item) => item.provider === 'coinbase' && item.status === 'active' && connectionEligible(item,this.#input.database));
    if (coinbase.length !== 1) return { ok: false, code: 'one_coinbase_connection_required' };
    const snapshot = getLatestConnectionAccountSnapshotV2(this.#input.profileId, coinbase[0]!.id, this.#input.database);
    const now = this.#input.clock.nowMs();
    if (snapshot === null || !snapshot.complete || snapshot.health !== 'healthy' ||
        now - snapshot.asOfMs > DAY_MS || snapshot.asOfMs > now) return { ok: false, code: 'fresh_coinbase_snapshot_required' };
    const opening = snapshot.balances.reduce((sum, item) => sum.plus(item.valueUsd ?? '0'), new Decimal(0));
    if (!opening.isPositive() || snapshot.balances.some((item) => item.valueUsd === null)) {
      return { ok: false, code: 'coinbase_valuation_incomplete' };
    }
    const preparation = await this.#input.refreshFor(now);
    if (!preparation.ok) return { ok: false, code: preparation.code };
    let client: Client;
    try { client = await this.#client(); } catch { return { ok: false, code: 'credentials_unavailable' }; }
    try {
      const [account, positions, orders, ...assets] = await Promise.all([
        client.account(), client.positions(), client.orders('open'),
        ...['BTCUSD', 'ETHUSD', 'LTCUSD'].map((symbol) => client.asset(symbol)),
      ]);
      if (account.id !== getSetting('alpaca.paper.account.id', this.#input.database) || account.currency !== 'USD' ||
          !['ACTIVE', 'PAPER_ONLY'].includes(account.status) || account.account_blocked || account.trading_blocked) {
        return { ok: false, code: 'alpaca_account_unavailable' };
      }
      if (positions.length > 0 || orders.length > 0 || !money(account.cash).isPositive() ||
          !money(account.cash).equals(account.equity)) return { ok: false, code: 'alpaca_account_not_clean' };
      if (assets.some((asset) => !asset.tradable || asset.status !== 'active' ||
          !money(asset.min_trade_increment ?? '0').isPositive() || !money(asset.min_order_size ?? '0').isPositive())) {
        return { ok: false, code: 'alpaca_asset_unavailable' };
      }
      const experiment: ParallelPaperExperiment = {
        id: sha256Hex(`parallel-paper:${this.#input.profileId}:${commandId}`),
        profileId: this.#input.profileId, sourceConnectionSnapshotId: snapshot.id,
        alpacaAccountId: account.id, openingCoquiCash: opening.toString(),
        openingAlpacaCash: account.cash, openingAlpacaEquity: account.equity,
        anchor: parallelAnchor(preparation.dataset), startedAt: now,
        configVersion: PARALLEL_TRENDVOL_VERSION,
      };
      saveParallelExperiment(experiment, this.#input.database);
      this.#append(experiment, 'started', 'started', { paperOnly: true, sourceSnapshotId: snapshot.id });
      return { ok: true, experiment };
    } catch (error) {
      return { ok: false, code: error instanceof AlpacaPaperError ? `alpaca_${error.code}` : 'alpaca_preflight_failed' };
    }
  }

  status() {
    const experiment = latestParallelExperiment(this.#input.profileId, this.#input.database);
    if (experiment === null) return { experiment: null, status: 'none' as const, events: [] as readonly ParallelPaperEvent[] };
    const events = this.#events(experiment);
    return { experiment, status: parallelExperimentStatus(events), events };
  }

  summary() { return parallelPaperSummary(this.status(), this.#input, this.#lastCheckAtMs, this.#checking, this.#tradeStream ? this.#tradeStreamStatus : 'unavailable'); }
  recordTradeUpdate(experimentId: string, update: AlpacaPaperTradeUpdate): void {
    const current = this.status();
    if (!current.experiment || current.experiment.id !== experimentId || current.status === 'stopped' || this.#suspended) return;
    const intent = current.events.find((event) => event.kind === 'external_intent' && event.detail['clientOrderId'] === update.clientOrderId);
    if (!intent || !current.events.some((event) => event.kind === 'submit_attempt' && event.detail['clientOrderId'] === update.clientOrderId) ||
        String(intent.detail['symbol']).replaceAll('/', '') !== update.symbol || intent.detail['side'] !== update.side ||
        Date.parse(update.at) < current.experiment.startedAt || Date.parse(update.at) > this.#input.clock.nowMs() + 5000) return;
    this.#append(current.experiment, 'broker_trade_update', `trade-update:${update.executionId}`, { ...update,
      accountId: current.experiment.alpacaAccountId, source: 'alpaca_paper_trade_updates', feeAttribution: 'unconfirmed' });
  }
  transition(kind: 'paused' | 'resumed' | 'stopped', commandId: string): boolean {
    const current = this.status();
    if (current.experiment === null || current.status === 'stopped') return false;
    if(kind==='resumed'){const source=getConnectionAccountSnapshotV2(this.#input.profileId,current.experiment.sourceConnectionSnapshotId,this.#input.database);const connection=source===null?null:getProfileConnectionV2(this.#input.profileId,source.connectionId,this.#input.database);if(connection===null||!connectionEligible(connection,this.#input.database))return false;}
    if (kind === 'resumed' && (this.#suspended || current.status !== 'paused' || this.#input.killSwitchEngaged() || this.summary().reconciliationAttention.blocked)) return false;
    const preflight = current.events.findLast((event) => event.kind === 'readiness' && event.detail['operation'] === 'resume_preflight' && event.detail['status'] === 'validated');
    if (kind === 'resumed' && (!preflight || this.#input.clock.nowMs() - preflight.at > 60_000 || preflight.at > this.#input.clock.nowMs())) return false;
    this.#append(current.experiment, kind, `transition:${commandId}`, { reason: 'user_action' });
    if (kind === 'stopped') { this.#tradeStream?.close(); this.#tradeStream = undefined; this.#tradeStreamKey = undefined; }
    return true;
  }
  async stop(commandId: string): Promise<boolean> {
    const current = this.status();
    if (current.experiment === null || current.status === 'stopped') return false;
    try {
      const client = await this.#client();
      const open = await client.orders('open');
      const known = new Set(current.events.filter((event) => event.kind === 'external_intent')
        .map((event) => event.detail['clientOrderId']));
      if (open.some((order) => !known.has(order.client_order_id))) return false;
      for (const order of open) {
        await client.cancel(order.id);
        this.#append(current.experiment, 'cancel_requested', `cancel:${order.id}`,
          { orderId: order.id, clientOrderId: order.client_order_id });
      }
      for (const order of open) {
        const confirmed = await client.orderByClientId(order.client_order_id);
        if (!['canceled', 'expired', 'filled', 'rejected'].includes(confirmed.status)) return false;
      }
      await this.#reconcile(current.experiment, client);
      this.#append(current.experiment, 'stopped', `transition:${commandId}`, { reason: 'user_action' });
      this.#tradeStream?.close(); this.#tradeStream = undefined; this.#tradeStreamKey = undefined;
      return true;
    } catch { return false; }
  }
  pauseForDisconnect(): void {
    const current = this.status();
    if (current.experiment !== null && current.status === 'active') {
      this.#append(current.experiment, 'paused', `disconnect:${this.#input.clock.nowMs()}`, { reason: 'alpaca_disconnected' });
    }
  }

  /** Operator retry performs reads only; the scheduler owns subsequent decisions. */
  async retryReconciliation(): Promise<void> {
    if (this.#checking || this.#suspended) throw new Error('host_unavailable');
    const current = this.status();
    if (!current.experiment || current.status === 'stopped') throw new Error('experiment_not_active');
    const experiment = current.experiment;
    this.#checking = true;
    this.#deadline = createRequestDeadline(() => this.#input.clock.nowMs());
    this.#pass = new ParallelPaperPass(this.#input.profileId, this.#input.database, this.#input.clock, this.#deadline);
    try {
      this.#claim = parallelExecutionClaim(this.#input.profileId, this.#input.hostId ?? 'desktop-main-test',
        this.#input.database, () => this.#input.clock.nowMs(), this.#deadline, this.#input.hostKind);
      const client = await this.#client();
      const clear = await validateParallelBroker(experiment, client, this.#events(experiment));
      await this.#reconcile(experiment, client, true);
      await this.#validateRecovery(experiment, client, clear);
      await this.#validateResume(experiment, client);
      this.#pass?.complete(experiment);
    } catch (error) {
      this.#append(experiment, 'reconciliation_error', `operator-retry:${this.#events(experiment).length}`,
        (this.#pass?.failure(error, 'reconciliation_unavailable') ?? parallelPaperFailureDetail(error, 'reconciliation_unavailable')));
    } finally {
      this.#claim?.release(); this.#claim = undefined; this.#deadline.dispose(); this.#deadline = undefined; this.#checking = false; this.#pass = undefined;
    }
  }

  async #validateRecovery(experiment: ParallelPaperExperiment, client: Client, clear: boolean): Promise<void> {
    if (this.#pass) this.#pass.phase = 'broker_reconciliation';
    if (!clear) throw new ParallelReconciliationError('broker_orders_pending', 'orders');
    if (!parallelAttemptsResolved(this.#events(experiment))) throw new ParallelReconciliationError('broker_fills_pending', 'order_lookup');
    await reconcilePaperPositionEvidence({ experiment, client, events: () => this.#events(experiment), now: () => this.#input.clock.nowMs(),
      allowMinorResolution: this.status().status === 'paused', fullAudit: () => this.#reconcile(experiment, client, true),
      append: (kind, key, detail) => this.#append(experiment, kind, key, detail) });
    this.#deadline?.check(); this.#claim?.check();
    this.#append(experiment, 'readiness', `broker-reconciled:${this.#events(experiment).length}`,
      { operation: 'broker_reconciliation', status: 'validated', observedAtMs: this.#input.clock.nowMs() });
  }

  async #validateResume(experiment: ParallelPaperExperiment, client: Client): Promise<void> {
    if (this.#input.killSwitchEngaged()) throw new Error('kill_switch_engaged');
    const preparation = await this.#prepare('recovery');
    if (!preparation.ok) throw new Error(preparation.code);
    if (dayAfter(preparation.dataset.dayKeys.at(-1)!) !== new Date(this.#input.clock.nowMs()).toISOString().slice(0, 10)) throw new Error('stale_market_data');
    this.#deadline?.check(); this.#claim?.check();
    this.#append(experiment, 'readiness', `resume-ready:${this.#events(experiment).length}`, { operation: 'resume_preflight', status: 'validated' });
    await client.latestCryptoQuotes().catch(() => undefined); // Health observation cannot block reconciliation or arm an order.
  }
  suspend(): void { this.#suspended = true; this.#deadline?.dispose(); this.#tradeStream?.close(); this.#tradeStream = undefined; this.#tradeStreamKey = undefined; }
  resume(): void {
    if (this.#suspended) {
      const existing = latestParallelExperiment(this.#input.profileId, this.#input.database);
      if (existing && this.status().status === 'active') this.#append(existing, 'paused',
        `ownership-pause:${countParallelEvents(existing.id, this.#input.profileId, this.#input.database)}`,
        { reason: 'ownership_transfer', reconciliationRequired: true, manualResumeRequired: true });
    }
    this.#suspended = false;
  }

  async tick(deadline?: RequestDeadline): Promise<void> {
    if (this.#checking || this.#suspended) return;
    this.#lastCheckAtMs = this.#input.clock.nowMs(); this.#checking = true;
    this.#deadline = deadline;
    this.#pass = new ParallelPaperPass(this.#input.profileId, this.#input.database, this.#input.clock, deadline);
    try {
      this.#claim = parallelExecutionClaim(this.#input.profileId, this.#input.hostId ?? 'desktop-main-test',
        this.#input.database, () => this.#input.clock.nowMs(), deadline, this.#input.hostKind);
      await this.#tick();
    } finally {
      try {
        const current = this.status();
        if (current.experiment) finalizeParallelSlots(current.experiment, current.events, this.#input.clock.nowMs(),
          (kind, key, detail) => this.#append(current.experiment!, kind, key, detail));
      } finally { this.#claim?.release(); this.#claim = undefined; this.#deadline = undefined; this.#checking = false; this.#pass = undefined; }
    }
  }

  #beforeSubmit(): void {
    if (this.#pass) this.#pass.phase = 'pre_submission';
    if (this.#suspended) throw new Error('host_unavailable');
    this.#deadline?.check(); this.#claim?.check();
    if (this.#deadline && this.#deadline.remainingMs() < 5_000) throw new ParallelBudgetError('pre_submission', this.#deadline, 5_000);
    if (this.#input.killSwitchEngaged()) throw new Error('kill_switch_engaged');
    if (this.status().status !== 'active') throw new Error('explicit_pause_preserved');
    if (!this.#input.preparation().ok) throw new Error('stale_market_data');
  }

  async #tick(): Promise<void> {
    const current = this.status();
    if (current.experiment === null || current.status === 'stopped') return;
    const experiment = current.experiment;
    const checkedAt = this.#input.clock.nowMs();
    const checkBucket = Math.floor(checkedAt / 60_000);
    if (!current.events.some((event) => event.kind === 'scheduler_check' && event.detail['bucket'] === checkBucket)) {
      this.#append(experiment, 'scheduler_check', `check:${checkBucket}`, {
        bucket: checkBucket, checkedAtMs: checkedAt, status: current.status, preparationOk: this.#input.preparation().ok });
    }
    if (current.status === 'paused') {
      try {
        const client = await this.#client();
        const brokerClear = await validateParallelBroker(experiment, client, this.#events(experiment));
        await this.#reconcile(experiment, client);
        await this.#validateRecovery(experiment, client, brokerClear);
        await this.#validateResume(experiment, client);
        this.#pass?.complete(experiment);
      } catch (error) {
        const detail = (this.#pass?.failure(error, 'reconciliation_unavailable') ?? parallelPaperFailureDetail(error, 'reconciliation_unavailable'));
        this.#append(experiment, 'reconciliation_error',
          `reconcile-failure:${checkedAt}:${detail.reason}:${this.#events(experiment).length}`, detail);
      }
      return;
    }
    if (this.#input.killSwitchEngaged()) {
      this.#append(experiment, 'paused', `kill:${this.#input.clock.nowMs()}`, { reason: 'kill_switch_engaged' });
      return;
    }
    let client: Client;
    try {
      client = await this.#client();
      const clear = await validateParallelBroker(experiment, client, this.#events(experiment));
      await this.#reconcile(experiment, client);
      if (this.#events(experiment).some((event) => event.kind === 'submit_attempt')) {
        if (!clear || !parallelAttemptsResolved(this.#events(experiment))) {
          const today = new Date(checkedAt).toISOString().slice(0, 10);
          if (checkedAt - Date.parse(`${today}T00:00:00Z`) > CUTOFF_MS && this.#events(experiment).some((event) =>
            event.kind === 'external_intent' && event.detail['day'] === new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10))) throw new Error('execution_window_missed');
          return;
        }
      } else if (!clear) return;
      await this.#validateRecovery(experiment, client, clear);
    }
    catch (error) {
      const detail = (this.#pass?.failure(error, 'reconciliation_unavailable') ?? parallelPaperFailureDetail(error, 'reconciliation_unavailable'));
      if (this.#pass?.defer(experiment, error)) return;
      this.#append(experiment, 'paused', `broker-failure:${checkedAt}:${this.#events(experiment).length}`, detail); return;
    }
    supersedeUnsubmittedParallelPlans(this.#events(experiment), (kind, key, detail) => this.#append(experiment, kind, key, detail));
    let preparation: PaperDecisionPreparation;
    try { preparation = await this.#prepare(); }
    catch (error) { const detail = (this.#pass?.failure(error, 'market_fetch_failed') ?? parallelPaperFailureDetail(error, 'market_fetch_failed'));
      if (this.#pass?.defer(experiment, error)) return;
      this.#append(experiment, 'paused', `preparation-failure:${checkedAt}:${this.#events(experiment).length}`, detail); return; }
    if (!preparation.ok) {
      this.#append(experiment, 'paused', `data:${this.#input.clock.nowMs()}`, { reason: preparation.code });
      return;
    }
    try {
      const today = new Date(this.#input.clock.nowMs()).toISOString().slice(0, 10);
      const day = preparation.dataset.dayKeys.at(-1);
      if (day === undefined || dayAfter(day) !== today) throw new Error('stale_market_data');
      let events = activeParallelEvents(this.#events(experiment));
      if (eventFor(events, 'decision', day) === undefined) {
        const decision = parallelDecision(preparation.dataset, experiment.anchor);
        this.#append(experiment, 'decision', `decision:${day}`, decision);
        events = activeParallelEvents(this.#events(experiment));
      }
      settleParallelLocal(experiment, preparation, this.#events(experiment), (kind, key, detail) => this.#append(experiment, kind, key, detail));
      if (this.#input.clock.nowMs() - Date.parse(`${today}T00:00:00Z`) <= CUTOFF_MS) {
        await executeParallelDaily({ experiment, client, preparation, day, today,
          now: () => this.#input.clock.nowMs(), events: () => this.#events(experiment),
          beforeSubmit: () => this.#beforeSubmit(), append: (kind, key, detail) => this.#append(experiment, kind, key, detail) });
      } else if (eventFor(events, 'external_complete', day) === undefined &&
          eventFor(events, 'daily_window_missed', day) === undefined) {
        this.#append(experiment, 'daily_window_missed', `daily-window-missed:${day}`, { day,
          intendedStartMs: Date.parse(`${today}T00:00:00Z`), cutoffMs: CUTOFF_MS,
          observedAtMs: this.#input.clock.nowMs(), decisionAtMs: eventFor(events, 'decision', day)?.at });
      }
      await executeParallelIntraday({ nowMs: this.#input.clock.nowMs(), now: () => this.#input.clock.nowMs(), experimentId: experiment.id,
        decision: eventFor(events, 'decision', day)!, events: () => this.#events(experiment),
        append: (kind, key, detail) => this.#append(experiment, kind, key, detail), client,
        beforeSubmit: () => this.#beforeSubmit(), expectedAccountId: experiment.alpacaAccountId,
        mlSignal: readParallelMlSignal(this.#input.mlSignal) });
      // Optional observations cannot turn a completed authoritative pass into an execution pause.
      const research = this.#deadline ? childRequestDeadline(this.#deadline, 10_000) : undefined;
      try { await withinDeadline((async () => {
        recordParallelMark({ experiment, events: this.#events(experiment), nowMs: this.#input.clock.nowMs(),
          append: (kind, key, detail) => this.#append(experiment, kind, key, detail) }, preparation, await client.account(), await client.positions());
        await recordFourHourExecutionObservation({ now: () => this.#input.clock.nowMs(), day,
          datasetHash: preparation.datasetHash,
          weights: eventFor(events, 'decision', day)!.detail['weights'] as Record<string, number>,
          events: () => this.#events(experiment), client,
          append: (kind, key, detail) => this.#append(experiment, kind, key, detail) });
        const decision = eventFor(this.#events(experiment), 'decision', day)!;
        const targetWeights = decision.detail['weights'] as Record<string,number>;
        await collectExecutionRemediationShadow({ profileId: this.#input.profileId, experimentId: experiment.id,
          db: this.#input.database, now: () => this.#input.clock.nowMs(), read: client,
          target: { id: decision.id, completedDay: day, datasetHash: preparation.datasetHash,
            weights: Object.fromEntries(Object.entries(targetWeights).map(([id,weight]) => [id,String(weight)])) },
          completedCloses: Object.fromEntries(ASSET_IDS.map((id) => [id,String(preparation.dataset.closesById[id]?.at(-1))])) });
        await collectParallelHourlyShadowSafely({ profileId: this.#input.profileId,
          experimentId: experiment.id, db: this.#input.database,
          nowMs: this.#input.clock.nowMs(), datasetHash: preparation.datasetHash,
          decision: { day, weights: decision.detail['weights'] as Record<string, number> }, read: client });
      })(), research); }
      catch (error) { this.#append(experiment, 'research_error', `research:${checkedAt}`,
        (this.#pass?.failure(error, 'research_unavailable') ?? parallelPaperFailureDetail(error, 'research_unavailable'))); }
      finally { research?.dispose(); }
      this.#pass?.complete(experiment);
    } catch (error) {
      if (this.#pass?.defer(experiment, error)) return;
      const detail = (this.#pass?.failure(error, 'paper_execution_unknown') ?? parallelPaperFailureDetail(error, 'paper_execution_unknown'));
      const events = this.#events(experiment);
      if (events.some((attempt) => attempt.kind === 'submit_attempt' && !events.some((order) =>
          order.kind === 'external_order' && order.detail['clientOrderId'] === attempt.detail['clientOrderId'])))
        detail.reason = 'submission_outcome_unknown';
      this.#append(experiment, 'paused', `failure:${this.#input.clock.nowMs()}:${detail.reason}:${this.#events(experiment).length}`, detail);
    }
  }

  #prepare(purpose: 'execution' | 'recovery' = 'execution'): Promise<PaperDecisionPreparation> {
    if (this.#pass) this.#pass.phase = 'market_preparation';
    return prepareParallelPass(this.#input, this.#deadline, purpose);
  }

  async #reconcile(experiment: ParallelPaperExperiment, client: Client, fullAudit = false): Promise<void> {
    if (this.#pass) this.#pass.phase = 'activity_reconciliation';
    await reconcileParallelPaper({ experiment, client, fullAudit, ...(this.#deadline ? { deadline: this.#deadline } : {}), events: () => this.#events(experiment),
      now: () => this.#input.clock.nowMs(), append: (kind, key, detail) => this.#append(experiment, kind, key, detail) });
  }



}
