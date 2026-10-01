import { studyCollection } from '../research/study-collection.js';
import { canonicalJson, sha256Hex, STUDY_BEHAVIOR_HASHES, HOURLY_EXECUTION_V1, hourlySlotAt,
  validateHourlyObservation, advanceHourlyExecution, openingHourlyState,
  replayHourlyExecution,
  type CanonicalJsonValue, type HourlyExecutionObservation, type HourlyVirtualOrder, type HourlyVirtualState } from '@coqui/core';
import { type createAlpacaPaperClient } from '@coqui/adapters';
import { appendRemediationEvidence, listRemediationEvidence, listStudyInstances, appendHourlyExecutionRecord, getHourlyExecutionRecord, hourlyExecutionCoverage,
  latestHourlyExecutionRecord, listHourlyExecutionRecords, type Db } from '@coqui/storage';

import { parallelQuotes } from './parallel-paper-intraday.js';
import { PARALLEL_INSTRUMENTS, PARALLEL_SYMBOLS } from './parallel-signal.js';
import { instrumentKey } from '@coqui/core';

type Client = ReturnType<typeof createAlpacaPaperClient>;
const DAY_MS = 86_400_000;
const CANDIDATE = HOURLY_EXECUTION_V1.id;

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
  const sourceHash = hourlyExecutionSourceHash();
  const planHash = sha256Hex(canonicalJson(HOURLY_EXECUTION_V1));
  const scoped = studyCollection({ profileId: input.profileId, experimentId: input.experimentId, candidateId: CANDIDATE,
    db: input.db, nowMs: input.nowMs, legacyHash: sourceHash,
    legacyList: (kind) => listHourlyExecutionRecords(input.profileId, kind as 'study' | 'observation' | 'shadow' | 'failure', input.db),
    legacyAppend: (kind,key,body) => appendHourlyExecutionRecord(input.profileId,
      { kind: kind as 'study' | 'observation' | 'shadow' | 'failure', key, atMs: input.nowMs, body }, input.db) });
  if (!scoped.ready) return;
  const study = scoped.list('study')[0];
  const getRecord = (_profile: string, kind: string, key: string, _db: Db) => { void _db; return scoped.list(kind).find((r) => r.key === key) ?? null; }
  const listRecords = (_profile: string, kind: string, _db: Db) => { void _db; return scoped.list(kind); };
  const appendRecord = (_profile: string, record: {kind: string; key: string; atMs: number; body: unknown}, _db: Db) =>
    { void _db; return scoped.append(record.kind, record.key, record.body); };
  const registered = study!.body as { startMs: number; foldEndsMs: number[]; holdoutEndMs: number;
    planHash: string; sourceHash: string; experimentId: string };
  if (registered.experimentId !== input.experimentId) throw new Error('hourly_experiment_changed');
  if (registered.planHash !== planHash || registered.sourceHash !== scoped.sourceHash) throw new Error('hourly_candidate_version_changed');
  if (slotMs < registered.startMs || slotMs >= registered.holdoutEndMs) return;
  const key = new Date(slotMs).toISOString().slice(0, 13);
  const existing = getRecord(input.profileId, 'observation', key, input.db);
  if (existing !== null && getRecord(input.profileId, 'shadow', key, input.db) !== null) return;
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
    const priorObservations = listRecords(input.profileId, 'observation', input.db);
    let opening: HourlyVirtualState | null = null;
    if (priorObservations.length === 0 || [registered.startMs, ...registered.foldEndsMs].includes(slotMs)) {
      const [account, positions] = scoped.instance ? [{cash:'100000'}, []] : await Promise.all([input.read.account(), input.read.positions()]);
      if (positions.some((position) => !PARALLEL_SYMBOLS.includes(position.symbol.replace('/', '') as typeof PARALLEL_SYMBOLS[number]))) {
        throw new Error('hourly_opening_unavailable');
      }
      opening = openingHourlyState(Number(account.cash), PARALLEL_SYMBOLS.map((symbol) =>
        Number(positions.find((position) => position.symbol.replace('/', '') === symbol)?.qty ?? '0')));
    }
    appendRecord(input.profileId, { kind: 'observation', key, atMs: slotMs,
      body: { observation, opening } }, input.db);
  }
  // Complete an interrupted observation before advancing; each shadow slot is one atomic immutable record.
  const observations = listRecords(input.profileId, 'observation', input.db);
  const recorded = new Map(listRecords(input.profileId, 'shadow', input.db)
    .map((record) => [record.key, record]));
  let state: HourlyVirtualState | null = null;
  for (const record of observations) {
    const body = record.body as { observation: HourlyExecutionObservation; opening: HourlyVirtualState | null };
    if (body.opening !== null) state = body.opening;
    if (state === null) state = body.opening;
    if (state === null) throw new Error('hourly_opening_unavailable');
    const previous = recorded.get(record.key);
    if (previous !== undefined) {
      state = (previous.body as { result: { state: HourlyVirtualState } }).result.state;
      continue;
    }
    const result = advanceHourlyExecution({ observation: body.observation, state,
      policy: CANDIDATE });
    appendRecord(input.profileId, { kind: 'shadow', key: record.key,
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
      const instance = listStudyInstances(input.profileId, CANDIDATE, input.db).at(-1);
      if (instance) {
        const key = `${slotMs}:${reason}`;
        if (!listRemediationEvidence(input.profileId, instance.id, 'failure', input.db).some((row)=>row.key===key))
          appendRemediationEvidence({profileId:input.profileId,namespace:instance.id,kind:'failure',key,
            atMs:input.nowMs,body:{reason,slotMs} as CanonicalJsonValue},input.db);
      } else appendHourlyExecutionRecord(input.profileId, { kind: 'failure',
        key: `${slotMs}:${reason}`, atMs: slotMs, body: { reason, slotMs } }, input.db);
    } catch { /* Research storage cannot interrupt authoritative paper execution. */ }
  }
}

export function hourlyExecutionSourceHash(): string {
  return sha256Hex([advanceHourlyExecution, validateHourlyObservation, replayHourlyExecution,
    collectParallelHourlyShadow].map(String).join('|') + (STUDY_BEHAVIOR_HASHES[CANDIDATE] ?? ''));
}
