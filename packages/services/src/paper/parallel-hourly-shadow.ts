import { canonicalJson, sha256Hex, HOURLY_EXECUTION_V1, hourlySlotAt,
  validateHourlyObservation, advanceHourlyExecution, openingHourlyState,
  replayHourlyExecution,
  type HourlyExecutionObservation, type HourlyVirtualOrder, type HourlyVirtualState } from '@coqui/core';
import { type createAlpacaPaperClient } from '@coqui/adapters';
import { appendHourlyExecutionRecord, getHourlyExecutionRecord, hourlyExecutionCoverage,
  latestHourlyExecutionRecord, listHourlyExecutionRecords, type Db } from '@coqui/storage';

import { parallelQuotes } from './parallel-paper-intraday.js';
import { PARALLEL_INSTRUMENTS, PARALLEL_SYMBOLS } from './parallel-signal.js';
import { instrumentKey } from '@coqui/core';

type Client = ReturnType<typeof createAlpacaPaperClient>;
const DAY_MS = 86_400_000;
const CANDIDATE = HOURLY_EXECUTION_V1.id;

function studyDates(registeredAtMs: number) {
  const startMs = (Math.floor(registeredAtMs / DAY_MS) + 1) * DAY_MS;
  return { startMs, foldEndsMs: [20, 40, 60].map((days) => startMs + days * DAY_MS),
    holdoutEndMs: startMs + 90 * DAY_MS };
}

export function hourlyShadowStatus(profileId: string, db: Db) {
  const study = getHourlyExecutionRecord(profileId, 'study', CANDIDATE, db);
  const coverage = hourlyExecutionCoverage(profileId, db);
  const failure = latestHourlyExecutionRecord(profileId, 'failure', db);
  const last = latestHourlyExecutionRecord(profileId, 'shadow', db);
  const body = last?.body as { result?: { orders?: readonly HourlyVirtualOrder[];
    blocked?: readonly { reason: string }[] } } | undefined;
  const startMs = (study?.body as { startMs?: number } | undefined)?.startMs ?? null;
  return { version: CANDIDATE, mode: 'shadow' as const, startMs,
    lastSlotMs: last?.atMs ?? null, observationCount: coverage.observations,
    completeDays: coverage.completeDays, lastModeledOrderCount: body?.result?.orders?.length ?? 0,
    lastModeledOrders: (body?.result?.orders ?? []).slice(0, 3).map((order) => ({
      symbol: PARALLEL_SYMBOLS[order.assetIndex] ?? 'unknown', side: order.side,
      quantity: order.quantity.toString(), filledQuantity: order.filledQuantity.toString(),
      remainingQuantity: order.remainingQuantity.toString() })),
    lastBlockedReasons: (body?.result?.blocked ?? []).map((item) => item.reason).slice(0, 3),
    lastFailureReason: failure === null || (last !== null && failure.atMs < last.atMs)
      ? null : String((failure.body as { reason?: string }).reason ?? 'hourly_shadow_unavailable') };
}

/** A read-only broker collector and virtual book. No Alpaca submit method is accepted. */
export async function collectParallelHourlyShadow(input: {
  readonly profileId: string; readonly experimentId: string; readonly db: Db; readonly nowMs: number;
  readonly datasetHash: string; readonly decision: { readonly day: string;
    readonly weights: Record<string, number> };
  readonly read: Pick<Client, 'latestCryptoQuotes' | 'asset' | 'account' | 'positions'>;
}): Promise<void> {
  const slotMs = hourlySlotAt(input.nowMs);
  if (slotMs === null || input.decision.day !== new Date(slotMs - DAY_MS).toISOString().slice(0, 10)) return;
  const sourceHash = sha256Hex([advanceHourlyExecution, validateHourlyObservation,
    replayHourlyExecution, collectParallelHourlyShadow].map(String).join('|'));
  const planHash = sha256Hex(canonicalJson(HOURLY_EXECUTION_V1));
  let study = getHourlyExecutionRecord(input.profileId, 'study', CANDIDATE, input.db);
  if (study === null) {
    const dates = studyDates(input.nowMs);
    appendHourlyExecutionRecord(input.profileId, { kind: 'study', key: CANDIDATE,
      atMs: input.nowMs, body: { version: CANDIDATE, experimentId: input.experimentId,
        registeredAtMs: input.nowMs,
        ...dates, config: HOURLY_EXECUTION_V1, planHash, sourceHash,
        signal: 'stored completed Coinbase UTC daily TrendVol decision',
        baseline: 'daily-plus-four-hour', opening: 'first observed paper account snapshot',
        fillModel: 'immediate market fill; modeled not observed',
        folds: 'three 20-day development blocks; untouched 30-day holdout' } }, input.db);
    study = getHourlyExecutionRecord(input.profileId, 'study', CANDIDATE, input.db);
  }
  const registered = study!.body as { startMs: number; foldEndsMs: number[]; holdoutEndMs: number;
    planHash: string; sourceHash: string; experimentId: string };
  if (registered.experimentId !== input.experimentId) throw new Error('hourly_experiment_changed');
  if (registered.planHash !== planHash || registered.sourceHash !== sourceHash) throw new Error('hourly_candidate_version_changed');
  if (slotMs < registered.startMs || slotMs >= registered.holdoutEndMs) return;
  const key = new Date(slotMs).toISOString().slice(0, 13);
  const existing = getHourlyExecutionRecord(input.profileId, 'observation', key, input.db);
  if (existing !== null && getHourlyExecutionRecord(input.profileId, 'shadow', key, input.db) !== null) return;
  if (existing === null) {
    const [rawQuotes, ...assets] = await Promise.all([input.read.latestCryptoQuotes(),
      ...PARALLEL_SYMBOLS.map((symbol) => input.read.asset(symbol))]);
    const quoteRead = parallelQuotes(rawQuotes, input.nowMs);
    const targets = PARALLEL_INSTRUMENTS.map((instrument) => input.decision.weights[instrumentKey(instrument)] ?? 0);
    const observation: HourlyExecutionObservation = { slotMs, capturedAtMs: input.nowMs,
      decisionDay: input.decision.day, datasetHash: input.datasetHash,
      targetHash: sha256Hex(canonicalJson({ day: input.decision.day, targets })), targets,
      quotes: PARALLEL_SYMBOLS.map((symbol) => ({ bid: Number(quoteRead.sides[symbol]!.bid),
        ask: Number(quoteRead.sides[symbol]!.ask), atMs: quoteRead.sides[symbol]!.atMs })),
      assets: assets.map((asset) => ({ tradable: asset.tradable, status: asset.status,
        minOrderSize: asset.min_order_size ?? '0', minTradeIncrement: asset.min_trade_increment ?? '0' })) };
    validateHourlyObservation(observation);
    const priorObservations = listHourlyExecutionRecords(input.profileId, 'observation', input.db);
    let opening: HourlyVirtualState | null = null;
    if (priorObservations.length === 0 || [registered.startMs, ...registered.foldEndsMs].includes(slotMs)) {
      const [account, positions] = await Promise.all([input.read.account(), input.read.positions()]);
      if (positions.some((position) => !PARALLEL_SYMBOLS.includes(position.symbol.replace('/', '') as typeof PARALLEL_SYMBOLS[number]))) {
        throw new Error('hourly_opening_unavailable');
      }
      opening = openingHourlyState(Number(account.cash), PARALLEL_SYMBOLS.map((symbol) =>
        Number(positions.find((position) => position.symbol.replace('/', '') === symbol)?.qty ?? '0')));
    }
    appendHourlyExecutionRecord(input.profileId, { kind: 'observation', key, atMs: slotMs,
      body: { observation, opening } }, input.db);
  }
  // Complete an interrupted observation before advancing; each shadow slot is one atomic immutable record.
  const observations = listHourlyExecutionRecords(input.profileId, 'observation', input.db);
  const recorded = new Map(listHourlyExecutionRecords(input.profileId, 'shadow', input.db)
    .map((record) => [record.key, record]));
  let state: HourlyVirtualState | null = null;
  for (const record of observations) {
    const body = record.body as { observation: HourlyExecutionObservation; opening: HourlyVirtualState | null };
    if (state === null) state = body.opening;
    if (state === null) throw new Error('hourly_opening_unavailable');
    const previous = recorded.get(record.key);
    if (previous !== undefined) {
      state = (previous.body as { result: { state: HourlyVirtualState } }).result.state;
      continue;
    }
    const result = advanceHourlyExecution({ observation: body.observation, state,
      policy: CANDIDATE });
    appendHourlyExecutionRecord(input.profileId, { kind: 'shadow', key: record.key,
      atMs: record.atMs, body: { targetHash: body.observation.targetHash,
        datasetHash: body.observation.datasetHash, result } }, input.db);
    state = result.state;
  }
}

export async function collectParallelHourlyShadowSafely(input: Parameters<typeof collectParallelHourlyShadow>[0]): Promise<void> {
  try { await collectParallelHourlyShadow(input); }
  catch (error) {
    const reason = error instanceof Error && /^[a-z_]+$/u.test(error.message)
      ? error.message : 'hourly_shadow_unavailable';
    const slotMs = Math.floor(input.nowMs / 3_600_000) * 3_600_000;
    try {
      appendHourlyExecutionRecord(input.profileId, { kind: 'failure',
        key: `${slotMs}:${reason}`, atMs: slotMs, body: { reason, slotMs } }, input.db);
    } catch { /* Research storage cannot interrupt authoritative paper execution. */ }
  }
}
