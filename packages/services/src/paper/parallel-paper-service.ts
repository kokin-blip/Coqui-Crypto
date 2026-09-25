import { Decimal } from 'decimal.js';

import { createAlpacaPaperClient, AlpacaPaperError, type AlpacaPaperAsset, type AlpacaPaperCredentials, type SecretStore } from '@coqui/adapters';
import { instrumentKey, sha256Hex, type Clock } from '@coqui/core';
import {
  appendParallelEvent, getLatestConnectionAccountSnapshotV2, getSetting,
  latestParallelExperiment, listParallelEvents, listProfileConnectionsV2,
  parallelExperimentStatus, saveParallelExperiment, type Db, type ParallelPaperEvent,
  type ParallelPaperExperiment,
} from '@coqui/storage';

import { PARALLEL_COSTS, PARALLEL_INSTRUMENTS, PARALLEL_TRENDVOL_VERSION,
  parallelAnchor, parallelDecision } from './parallel-signal.js';
import { parallelDayReconciled, parallelRuntimeState, projectParallelPaperActivity } from './parallel-paper-activity.js';
import type { PaperDecisionPreparation } from './runtime-model.js';

const DAY_MS = 86_400_000;
const CUTOFF_MS = 15 * 60_000;
const MIN_TRADE = new Decimal(25);
const BAND = new Decimal('0.05');
const ASSET_IDS = PARALLEL_INSTRUMENTS.map(instrumentKey);
type Client = ReturnType<typeof createAlpacaPaperClient>;

function money(value: string | number | Decimal): Decimal {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error('invalid_amount');
  return result;
}

function quantity(value: Decimal): string {
  return value.toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN).toFixed(8);
}

function alpacaQuantity(value: Decimal, asset: AlpacaPaperAsset): Decimal {
  const increment = money(asset.min_trade_increment ?? '0');
  const minimum = money(asset.min_order_size ?? '0');
  if (!increment.isPositive() || !minimum.isPositive() || !asset.tradable || asset.status !== 'active') {
    throw new Error('alpaca_asset_rules_unavailable');
  }
  const rounded = value.abs().div(increment).floor().mul(increment);
  return rounded.lessThan(minimum) ? new Decimal(0) : rounded;
}

function symbolFor(id: string): string {
  const found = PARALLEL_INSTRUMENTS.find((item) => instrumentKey(item) === id);
  if (found === undefined) throw new Error('unknown_asset');
  return found.productId.replace('-', '');
}

function dayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

function eventFor(events: readonly ParallelPaperEvent[], kind: string, day: string): ParallelPaperEvent | undefined {
  return events.find((event) => event.kind === kind && event.detail['day'] === day);
}

export interface ParallelPaperDependencies {
  readonly profileId: string;
  readonly database: Db;
  readonly clock: Clock;
  readonly secrets?: SecretStore;
  readonly preparation: () => PaperDecisionPreparation;
  readonly refreshFor: (nowMs: number) => Promise<PaperDecisionPreparation>;
  readonly clientFactory?: (credentials: AlpacaPaperCredentials) => Client;
  readonly killSwitchEngaged: () => boolean;
}

export class ParallelPaperService {
  readonly #input: ParallelPaperDependencies;
  readonly #clientFactory: (credentials: AlpacaPaperCredentials) => Client;
  #lastCheckAtMs: number | null = null;
  #checking = false;

  constructor(input: ParallelPaperDependencies) {
    this.#input = input;
    this.#clientFactory = input.clientFactory ?? createAlpacaPaperClient;
  }

  #events(experiment: ParallelPaperExperiment): readonly ParallelPaperEvent[] {
    return listParallelEvents(experiment.id, this.#input.profileId, this.#input.database);
  }

  #append(experiment: ParallelPaperExperiment, kind: string, key: string, detail: Record<string, unknown>): void {
    appendParallelEvent({ experimentId: experiment.id, profileId: this.#input.profileId,
      kind, key, at: this.#input.clock.nowMs(), detail }, this.#input.database);
  }

  async #client(): Promise<Client> {
    if (this.#input.secrets === undefined) throw new Error('secret_store_unavailable');
    const stored = await this.#input.secrets.read('alpaca-paper-credentials', this.#input.profileId);
    if (!stored.ok || stored.value === null) throw new Error('credentials_unavailable');
    let parsed: unknown;
    try { parsed = JSON.parse(stored.value); } catch { throw new Error('credentials_unavailable'); }
    if (typeof parsed !== 'object' || parsed === null || !('keyId' in parsed) || !('secretKey' in parsed) ||
        typeof parsed.keyId !== 'string' || typeof parsed.secretKey !== 'string') throw new Error('credentials_unavailable');
    return this.#clientFactory({ keyId: parsed.keyId, secretKey: parsed.secretKey });
  }

  async start(commandId: string, smokeVerified: boolean): Promise<{ ok: true; experiment: ParallelPaperExperiment } | { ok: false; code: string }> {
    if (!smokeVerified) return { ok: false, code: 'paper_smoke_verification_required' };
    const current = latestParallelExperiment(this.#input.profileId, this.#input.database);
    if (current !== null && parallelExperimentStatus(this.#events(current)) !== 'stopped') {
      return { ok: false, code: 'experiment_already_active' };
    }
    if (this.#input.killSwitchEngaged()) return { ok: false, code: 'kill_switch_engaged' };
    const coinbase = listProfileConnectionsV2(this.#input.profileId, this.#input.database)
      .filter((item) => item.provider === 'coinbase' && item.status === 'active');
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

  summary() {
    const current = this.status(), experiment = current.experiment, events = current.events;
    const mark = [...events].reverse().find((event) => event.kind === 'account_mark');
    const latestState = [...events].reverse().find((event) => ['paused', 'resumed', 'stopped', 'started'].includes(event.kind));
    const { latestDecision, lastDecisionAtMs, decisionDay, activity } = projectParallelPaperActivity(events), completed = parallelDayReconciled(events, decisionDay);
    const runtimeState = parallelRuntimeState({ exists: experiment !== null, status: current.status,
      pauseReason: latestState?.detail['reason'], lastCheckAtMs: this.#lastCheckAtMs, checking: this.#checking,
      nowMs: this.#input.clock.nowMs(), decisionDay, completed });
    const coquiEquity = mark === undefined ? null : String(mark.detail['coquiEquityUsd']),
      alpacaEquity = mark === undefined ? null : String(mark.detail['alpacaEquityUsd']);
    const percent = (currentValue: string | null, opening: string): string | null => currentValue === null
      ? null : money(currentValue).div(opening).minus(1).mul(100).toDecimalPlaces(2).toFixed(2);
    return {
      experimentId: experiment?.id ?? null, state: current.status,
      startedAtMs: experiment?.startedAt ?? null,
      coquiOpeningUsd: experiment?.openingCoquiCash ?? null,
      alpacaOpeningUsd: experiment?.openingAlpacaEquity ?? null,
      coquiEquityUsd: coquiEquity, alpacaEquityUsd: alpacaEquity,
      coquiReturnPct: experiment === null ? null : percent(coquiEquity, experiment.openingCoquiCash),
      alpacaReturnPct: experiment === null ? null : percent(alpacaEquity, experiment.openingAlpacaEquity),
      lastMarkDay: mark === undefined ? null : String(mark.detail['day']),
      decisionCount: events.filter((event) => event.kind === 'decision').length,
      runtimeState, lastCheckAtMs: this.#lastCheckAtMs,
      lastDecisionAtMs, latestDecision, activity,
      coquiFillCount: events.filter((event) => event.kind === 'local_fill').length,
      alpacaFillCount: events.filter((event) => event.kind === 'external_fill').length,
      alpacaOrderCount: events.filter((event) => event.kind === 'external_intent').length,
      coquiFeesUsd: events.filter((event) => event.kind === 'local_fill')
        .reduce((sum, event) => sum.plus(String(event.detail['fee'])), new Decimal(0)).toFixed(2),
      alpacaBookedFeesUsd: null,
      alpacaModeledFrictionUsd: events.filter((event) => event.kind === 'external_fill')
        .reduce((sum, event) => event.detail['quantity'] === null || event.detail['price'] === null
          ? sum : sum.plus(money(String(event.detail['quantity'])).abs()
            .mul(String(event.detail['price'])).mul('0.0085')), new Decimal(0)).toFixed(2),
      positions: mark === undefined ? [] : mark.detail['positions'],
      targets: mark === undefined ? [] : mark.detail['targets'],
      recentTrades: events.filter((event) => ['local_fill', 'external_fill'].includes(event.kind))
        .slice(-20).map((event) => ({ source: event.kind === 'local_fill' ? 'coqui' as const : 'alpaca_paper' as const,
          atMs: event.at, symbol: String(event.detail['symbol'] ?? ''),
          quantity: String(event.detail['qty'] ?? event.detail['quantity'] ?? ''),
          price: String(event.detail['fillPrice'] ?? event.detail['price'] ?? ''),
          feeUsd: event.kind === 'local_fill' ? String(event.detail['fee']) : null })),
      lastReason: latestState?.kind === 'paused' ? String(latestState.detail['reason']) : null,
      paperOnly: true as const,
    };
  }

  transition(kind: 'paused' | 'resumed' | 'stopped', commandId: string): boolean {
    const current = this.status();
    if (current.experiment === null || current.status === 'stopped') return false;
    if (kind === 'resumed' && (current.status !== 'paused' || this.#input.killSwitchEngaged())) return false;
    this.#append(current.experiment, kind, `transition:${commandId}`, { reason: 'user_action' });
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
      return true;
    } catch { return false; }
  }

  pauseForDisconnect(): void {
    const current = this.status();
    if (current.experiment !== null && current.status === 'active') {
      this.#append(current.experiment, 'paused', `disconnect:${this.#input.clock.nowMs()}`, { reason: 'alpaca_disconnected' });
    }
  }

  async tick(): Promise<void> {
    this.#lastCheckAtMs = this.#input.clock.nowMs(); this.#checking = true;
    try { await this.#tick(); } finally { this.#checking = false; }
  }

  async #tick(): Promise<void> {
    const current = this.status();
    if (current.experiment === null || current.status === 'stopped') return;
    const experiment = current.experiment;
    if (current.status === 'paused') {
      try {
        const client = await this.#client();
        await this.#reconcile(experiment, client);
        const preparation = this.#input.preparation();
        if (preparation.ok) this.#recordMark(experiment, preparation, await client.account(), await client.positions());
      } catch (error) {
        const reason = error instanceof AlpacaPaperError ? `alpaca_${error.code}`
          : error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : 'reconciliation_unavailable';
        this.#append(experiment, 'paused', `reconcile-failure:${reason}`, { reason });
      }
      return;
    }
    if (this.#input.killSwitchEngaged()) {
      this.#append(experiment, 'paused', `kill:${this.#input.clock.nowMs()}`, { reason: 'kill_switch_engaged' });
      return;
    }
    const preparation = this.#input.preparation();
    if (!preparation.ok) {
      this.#append(experiment, 'paused', `data:${this.#input.clock.nowMs()}`, { reason: preparation.code });
      return;
    }
    try {
      const client = await this.#client();
      const account = await client.account();
      if (account.id !== experiment.alpacaAccountId || !['ACTIVE', 'PAPER_ONLY'].includes(account.status) ||
          account.trading_blocked || account.account_blocked) {
        throw new Error('alpaca_account_changed');
      }
      await this.#reconcile(experiment, client);
      this.#settleLocal(experiment, preparation);
      const today = new Date(this.#input.clock.nowMs()).toISOString().slice(0, 10);
      const day = preparation.dataset.dayKeys.at(-1);
      if (day === undefined || dayAfter(day) !== today) throw new Error('stale_market_data');
      let events = this.#events(experiment);
      if (eventFor(events, 'decision', day) === undefined &&
          this.#input.clock.nowMs() - Date.parse(`${today}T00:00:00Z`) <= CUTOFF_MS) {
        const decision = parallelDecision(preparation.dataset, experiment.anchor);
        this.#append(experiment, 'decision', `decision:${day}`, decision);
        events = this.#events(experiment);
      }
      if (eventFor(events, 'decision', day) !== undefined) {
        await this.#executeExternal(experiment, client, preparation, day, today);
      }
      this.#recordMark(experiment, preparation, await client.account(), await client.positions());
    } catch (error) {
      const reason = error instanceof AlpacaPaperError ? `alpaca_${error.code}`
        : error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : 'paper_execution_unknown';
      this.#append(experiment, 'paused', `failure:${this.#input.clock.nowMs()}:${reason}`, { reason });
    }
  }

  #recordMark(experiment: ParallelPaperExperiment,
    preparation: Extract<PaperDecisionPreparation, { ok: true }>,
    account: { readonly cash: string; readonly equity: string },
    positions: readonly { readonly symbol: string; readonly qty: string; readonly market_value: string }[]): void {
    const day = preparation.dataset.dayKeys.at(-1)!;
    const events = this.#events(experiment);
    if (eventFor(events, 'account_mark', day) !== undefined) return;
    const nextOpenMs = Date.parse(`${dayAfter(day)}T00:00:00Z`);
    if (eventFor(events, 'external_complete', day) === undefined &&
        this.#input.clock.nowMs() - nextOpenMs < CUTOFF_MS) return;
    let cash = money(experiment.openingCoquiCash);
    const held = new Map<string, Decimal>(ASSET_IDS.map((id) => [id, new Decimal(0)]));
    for (const fill of events.filter((event) => event.kind === 'local_fill')) {
      const id = String(fill.detail['assetId']);
      held.set(id, held.get(id)!.plus(String(fill.detail['qty'])));
      cash = cash.plus(String(fill.detail['cashDelta']));
    }
    const local = ASSET_IDS.reduce((sum, id) => sum.plus(held.get(id)!.mul(
      String(preparation.dataset.closesById[id]?.at(-1)))), cash);
    const decision = [...events].reverse().find((event) => event.kind === 'decision');
    const weights = (decision?.detail['weights'] ?? {}) as Record<string, number>;
    const detail = { day, coquiEquityUsd: local.toFixed(2), coquiCashUsd: cash.toFixed(2),
      alpacaEquityUsd: money(account.equity).toFixed(2), alpacaCashUsd: money(account.cash).toFixed(2),
      positions: ASSET_IDS.map((id) => {
        const symbol = symbolFor(id);
        const external = positions.find((item) => item.symbol.replace('/', '') === symbol);
        return { symbol, coquiQty: held.get(id)!.toString(),
          alpacaQty: external?.qty ?? '0',
          coquiValueUsd: held.get(id)!.mul(String(preparation.dataset.closesById[id]?.at(-1))).toFixed(2),
          alpacaValueUsd: external?.market_value ?? '0' };
      }),
      targets: ASSET_IDS.map((id) => ({ symbol: symbolFor(id), weightPct: String(money(String(weights[id] ?? 0)).mul(100)) })),
    };
    this.#append(experiment, 'account_mark', `mark:${day}`, detail);
  }

  async #reconcile(experiment: ParallelPaperExperiment, client: Client): Promise<void> {
    const events = this.#events(experiment);
    const intents = events.filter((event) => event.kind === 'external_intent');
    for (const intent of intents) {
      const id = String(intent.detail['clientOrderId']);
      const attempted = events.some((event) => event.kind === 'submit_attempt' && event.detail['clientOrderId'] === id);
      if (!attempted) continue;
      const last = [...events].reverse().find((event) => event.kind === 'external_order' && event.detail['clientOrderId'] === id);
      if (last?.detail['status'] === 'filled' && events.filter((event) => event.kind === 'external_fill' &&
          event.detail['orderId'] === last.detail['orderId'])
        .reduce((sum, event) => sum.plus(String(event.detail['quantity'] ?? '0')), new Decimal(0))
        .greaterThanOrEqualTo(String(last.detail['filledQty']))) continue;
      let order;
      try { order = await client.orderByClientId(id); }
      catch (error) {
        if (error instanceof AlpacaPaperError && error.code === 'not_found') {
          throw new Error('submission_outcome_unknown', { cause: error });
        }
        throw error;
      }
      this.#append(experiment, 'external_order', `order:${order.id}:${order.status}:${order.filled_qty}`,
        { clientOrderId: id, orderId: order.id, status: order.status, filledQty: order.filled_qty,
          filledAvgPrice: order.filled_avg_price, symbol: order.symbol, side: order.side });
      const cancelRequested = events.some((event) => event.kind === 'cancel_requested' && event.detail['orderId'] === order.id);
      if (['rejected', 'expired', 'suspended'].includes(order.status) ||
          (order.status === 'canceled' && !cancelRequested)) throw new Error('alpaca_order_failed');
    }
    const latestFill = [...events].reverse().find((event) => event.kind === 'external_fill' &&
      typeof event.detail['at'] === 'string');
    const afterMs = latestFill === undefined ? experiment.startedAt
      : Math.max(experiment.startedAt, Date.parse(String(latestFill.detail['at'])) - DAY_MS);
    if (!Number.isFinite(afterMs)) throw new Error('invalid_activity_timestamp');
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const activities = await client.activities(new Date(afterMs).toISOString(), cursor);
      for (const item of activities) {
        if (intents.some((intent) => events.some((event) => event.kind === 'external_order' &&
            event.detail['clientOrderId'] === intent.detail['clientOrderId'] && event.detail['orderId'] === item.order_id))) {
          this.#append(experiment, 'external_fill', `fill:${item.id}`,
            { activityId: item.id, orderId: item.order_id ?? null, symbol: item.symbol ?? null,
              quantity: item.qty ?? null, price: item.price ?? null, at: item.transaction_time ?? null });
        }
      }
      if (activities.length < 100) break;
      if (page === 19) throw new Error('alpaca_activity_page_limit');
      cursor = activities.at(-1)?.id;
      if (cursor === undefined) break;
    }
  }

  #settleLocal(experiment: ParallelPaperExperiment, preparation: Extract<PaperDecisionPreparation, { ok: true }>): void {
    const dataset = preparation.dataset;
    const events = this.#events(experiment);
    const decisions = events.filter((event) => event.kind === 'decision');
    let cash = money(experiment.openingCoquiCash);
    const held = new Map<string, Decimal>(ASSET_IDS.map((id) => [id, new Decimal(0)]));
    for (const fill of events.filter((event) => event.kind === 'local_fill')) {
      const id = String(fill.detail['assetId']);
      held.set(id, (held.get(id) ?? new Decimal(0)).plus(String(fill.detail['qty'])));
      cash = cash.plus(String(fill.detail['cashDelta']));
    }
    for (const decision of decisions) {
      const day = String(decision.detail['day']);
      const executionDay = dayAfter(day);
      if (!dataset.dayKeys.includes(executionDay) || eventFor(events, 'local_settled', day) !== undefined) continue;
      const index = dataset.dayKeys.indexOf(executionDay);
      const opens = new Map(ASSET_IDS.map((id) => [id, money(String(dataset.opensById[id]?.[index]))]));
      const equity = ASSET_IDS.reduce((sum, id) => sum.plus(held.get(id)!.mul(opens.get(id)!)), cash);
      if (!equity.isPositive()) throw new Error('local_wallet_unavailable');
      const weights = decision.detail['weights'] as Record<string, number>;
      const orders = ASSET_IDS.map((id) => {
        const price = opens.get(id)!;
        const actual = held.get(id)!.mul(price).div(equity);
        const target = money(String(weights[id]));
        const delta = money(quantity(equity.mul(target).div(price).minus(held.get(id)!)));
        return { id, price, delta, drift: target.minus(actual).abs() };
      }).filter((item) => item.drift.greaterThanOrEqualTo(BAND) && item.delta.abs().mul(item.price).greaterThanOrEqualTo(MIN_TRADE))
        .sort((a, b) => a.delta.isNegative() === b.delta.isNegative() ? a.id.localeCompare(b.id) : a.delta.isNegative() ? -1 : 1);
      for (const order of orders) {
        let qty = order.delta;
        const friction = money(PARALLEL_COSTS.spread).plus(PARALLEL_COSTS.slippage);
        if (qty.isPositive()) {
          const cap = money(quantity(cash.div(order.price.mul(new Decimal(1).plus(friction))
            .div(new Decimal(1).plus(PARALLEL_COSTS.fee)))));
          qty = Decimal.min(qty, cap);
        }
        if (qty.isZero() || qty.abs().mul(order.price).lessThan(MIN_TRADE)) continue;
        const fillPrice = order.price.mul(qty.isPositive() ? new Decimal(1).plus(friction) : new Decimal(1).minus(friction));
        const fee = qty.abs().mul(fillPrice).mul(PARALLEL_COSTS.fee);
        const cashDelta = qty.mul(fillPrice).neg().minus(fee);
        cash = cash.plus(cashDelta);
        held.set(order.id, held.get(order.id)!.plus(qty));
        this.#append(experiment, 'local_fill', `local:${day}:${order.id}`,
          { day: executionDay, decisionDay: day, assetId: order.id, symbol: symbolFor(order.id),
            qty: quantity(qty), rawOpen: order.price.toString(), fillPrice: fillPrice.toString(),
            fee: fee.toString(), cashDelta: cashDelta.toString() });
      }
      this.#append(experiment, 'local_settled', `local-settled:${day}`, { day, executionDay });
    }
  }

  async #executeExternal(experiment: ParallelPaperExperiment, client: Client,
    preparation: Extract<PaperDecisionPreparation, { ok: true }>, day: string, today: string): Promise<void> {
    if (eventFor(this.#events(experiment), 'external_complete', day) !== undefined) return;
    if (this.#input.clock.nowMs() - Date.parse(`${today}T00:00:00Z`) > CUTOFF_MS) {
      throw new Error('execution_window_missed');
    }
    let events = this.#events(experiment);
    const decision = eventFor(events, 'decision', day)!;
    const weights = decision.detail['weights'] as Record<string, number>;
    const account = await client.account();
    const openOrders = await client.orders('open');
    const ourIds = new Set(events.filter((event) => event.kind === 'external_intent').map((event) => event.detail['clientOrderId']));
    if (openOrders.some((order) => !ourIds.has(order.client_order_id))) throw new Error('unexpected_alpaca_order');
    const prices = Object.fromEntries(ASSET_IDS.map((id) => [symbolFor(id),
      money(String(preparation.dataset.closesById[id]?.at(-1)))])) as Record<string, Decimal>;
    const equity = money(account.equity);
    if (!equity.isPositive()) throw new Error('alpaca_equity_unavailable');
    const planStage = async (stage: 'sell' | 'buy'): Promise<void> => {
      events = this.#events(experiment);
      if (eventFor(events, `${stage}_plan`, day) === undefined) {
        const [freshPositions, ...assets] = await Promise.all([client.positions(),
          ...['BTCUSD', 'ETHUSD', 'LTCUSD'].map((symbol) => client.asset(symbol))]);
        const assetBySymbol = new Map(assets.map((asset) => [asset.symbol.replace('/', ''), asset]));
        const freshAccount = await client.account();
        let available = money(freshAccount.cash);
        const planned: { symbol: string; qty: string; side: 'buy' | 'sell'; clientOrderId: string }[] = [];
        for (const id of ASSET_IDS) {
          const symbol = symbolFor(id);
          const position = freshPositions.find((item) => item.symbol.replace('/', '') === symbol);
          const heldQty = money(position?.qty ?? '0');
          const actualValue = money(position?.market_value ?? '0');
          const targetValue = equity.mul(String(weights[id]));
          if (targetValue.minus(actualValue).abs().div(equity).lessThan(BAND)) continue;
          let delta = money(quantity(targetValue.div(prices[symbol]!).minus(heldQty)));
          if ((stage === 'sell' && !delta.isNegative()) || (stage === 'buy' && !delta.isPositive())) continue;
          if (stage === 'sell') delta = Decimal.max(delta, heldQty.neg());
          if (stage === 'buy') {
            const cap = money(quantity(available.div(prices[symbol]!.mul('1.01'))));
            delta = Decimal.min(delta, cap);
            available = available.minus(delta.mul(prices[symbol]!).mul('1.01'));
          }
          const rules = assetBySymbol.get(symbol);
          if (rules === undefined) throw new Error('alpaca_asset_rules_unavailable');
          const sized = alpacaQuantity(delta, rules);
          if (sized.mul(prices[symbol]!).lessThan(MIN_TRADE)) continue;
          planned.push({ symbol, qty: sized.toString(), side: stage,
            clientOrderId: `coqui-${experiment.id.slice(0,12)}-${day.replaceAll('-', '')}-${stage}-${symbol}` });
        }
        this.#append(experiment, `${stage}_plan`, `${stage}-plan:${day}`, { day, count: planned.length });
        for (const item of planned) this.#append(experiment, 'external_intent', `intent:${item.clientOrderId}`,
          { day, ...item });
      }
      events = this.#events(experiment);
      const intents = events.filter((event) => event.kind === 'external_intent' && event.detail['day'] === day && event.detail['side'] === stage);
      for (const intent of intents) {
        const clientOrderId = String(intent.detail['clientOrderId']);
        if (!events.some((event) => event.kind === 'submit_attempt' && event.detail['clientOrderId'] === clientOrderId)) {
          this.#append(experiment, 'submit_attempt', `attempt:${clientOrderId}`, { clientOrderId, day });
          const order = await client.submit({ client_order_id: clientOrderId,
            symbol: String(intent.detail['symbol']), side: stage, qty: String(intent.detail['qty']) });
          this.#append(experiment, 'external_order', `order:${order.id}:${order.status}:${order.filled_qty}`,
            { clientOrderId, orderId: order.id, status: order.status, filledQty: order.filled_qty,
              filledAvgPrice: order.filled_avg_price, symbol: order.symbol, side: order.side });
        }
      }
    };
    await planStage('sell');
    events = this.#events(experiment);
    const sellIntents = events.filter((event) => event.kind === 'external_intent' && event.detail['day'] === day && event.detail['side'] === 'sell');
    for (const intent of sellIntents) {
      const order = await client.orderByClientId(String(intent.detail['clientOrderId']));
      if (order.status !== 'filled') return;
    }
    await planStage('buy');
    events = this.#events(experiment);
    const buyIntents = events.filter((event) => event.kind === 'external_intent' && event.detail['day'] === day && event.detail['side'] === 'buy');
    for (const intent of buyIntents) {
      const order = await client.orderByClientId(String(intent.detail['clientOrderId']));
      if (order.status !== 'filled') return;
    }
    this.#append(experiment, 'external_complete', `external-complete:${day}`, { day });
  }
}
