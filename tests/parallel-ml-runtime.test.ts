import { createRequestDeadline } from '../packages/adapters/src/index.js';
import { describe, expect, it, vi } from 'vitest';
import { createMlSignalRuntime } from '../apps/desktop/src/main/ml-signal-runtime.js';
import { inferParallelMlSignal, ML_INFERENCE_VERSION } from '../packages/services/src/paper/parallel-ml-inference.js';
import { canonicalJson, connectionAccountSnapshotV2Hash, FixedClock, instrumentKey, ML_SIGNAL_VERSION,
  profileConnectionV2, sha256Hex, type ConnectionAccountSnapshotV2 } from '../packages/core/src/index.js';
import { PARALLEL_INSTRUMENTS } from '../packages/services/src/index.js';
import { appendParallelEvent, getMlSignalStudy, listMlHourlyBars, listParallelEvents, openDatabase, saveConnectionAccountSnapshotV2,
  saveProfileConnectionV2, saveParallelExperiment, saveMlHourlyBars, registerMlSignalStudy, finishMlSignalStudy,
  type MlHourlyBar } from '../packages/storage/src/index.js';
import type { createHistoricalCoinbaseCandleSource } from '../apps/desktop/src/main/coinbase-candle-source.js';
const NOW = Date.parse('2026-10-01T04:01:00Z'), HOUR = 3_600_000, DAY = 24 * HOUR;
function setup(paused = true) {
  const db = openDatabase(':memory:'), clock = new FixedClock(NOW);
  const connection = profileConnectionV2('main', 'coinbase', sha256Hex('key'), NOW);
  saveProfileConnectionV2(connection, db);
  const material = { schemaVersion: 2 as const, profileId: 'main', connectionId: connection.id, provider: 'coinbase' as const,
    asOfMs: NOW, balances: [], cashUsd: '1000', buyingPowerUsd: '1000', pendingOrderIds: [],
    permissions: { accountRead: true, marketRead: true, orderRead: true, trade: false as const },
    rulesHash: null, feeEvidenceHash: null, health: 'healthy' as const, failureReason: null, complete: true,
    provenance: { source: 'coinbase' as const, requestedAtMs: NOW, receivedAtMs: NOW } };
  const contentHash = connectionAccountSnapshotV2Hash({ ...material, id: '', contentHash: '' });
  const source: ConnectionAccountSnapshotV2 = { ...material, id: sha256Hex(`connection-account-snapshot-v2:${contentHash}`), contentHash };
  saveConnectionAccountSnapshotV2(source, db);
  const experiment = { id: sha256Hex('experiment'), profileId: 'main', sourceConnectionSnapshotId: source.id,
    alpacaAccountId: 'test', openingCoquiCash: '1000', openingAlpacaCash: '100000', openingAlpacaEquity: '100000',
    anchor: {}, startedAt: NOW - DAY, configVersion: 'test' };
  saveParallelExperiment(experiment, db);
  const append = (kind: string, key: string, detail: Record<string, unknown>) => appendParallelEvent({
    experimentId: experiment.id, profileId: 'main', kind, key, at: clock.nowMs(), detail }, db);
  append('started', 'started', {});
  if (paused) append('paused', 'user-pause', { reason: 'user_action' });
  const weights = Object.fromEntries(PARALLEL_INSTRUMENTS.map((instrument) => [instrumentKey(instrument), 0.2]));
  append('decision', 'decision', { day: '2026-09-30', weights });
  append('ml_target', 'ml-target', { slot: '2026-10-01T04', predictedAtMs: null, prediction: null, applied: false,
    baselineWeights: weights, proposedWeights: null, combinedWeights: weights, reason: 'ml_prediction_unavailable_or_stale' });
  const bars: MlHourlyBar[] = Array.from({ length: 140 * 24 }, (_, index) => PARALLEL_INSTRUMENTS.map((instrument, asset) => {
    const price = 100 * (asset + 1) * (1 + index / 100_000);
    return { productId: instrument.productId as MlHourlyBar['productId'], startTimeMs: NOW - 60_000 - 140 * DAY + index * HOUR,
      open: String(price), high: String(price * 1.01), low: String(price * 0.99), close: String(price * 1.0001),
      volume: null, source: 'public' as const, retrievedAtMs: NOW };
  })).flat();
  saveMlHourlyBars('main', bars, db);
  const read = vi.fn(async () => ({ ok: false as const }));
  const sourcePort = { researchHourlyWindow: read } as unknown as ReturnType<typeof createHistoricalCoinbaseCandleSource>;
  const worker = vi.fn(async (input: Parameters<typeof inferParallelMlSignal>[0]) => inferParallelMlSignal(input));
  const create = (run = worker) => createMlSignalRuntime({ profileId: 'main', database: db,
    nowMs: () => clock.nowMs(), candleSource: sourcePort, worker: run, onUnexpectedError: vi.fn() });
  return { db, clock, bars, read, worker, create, append,
    events: () => listParallelEvents(experiment.id, 'main', db) };
}
describe('ML runtime scheduling and immutability', () => {
  it('preempts a running shadow worker when an execution pass begins', async () => {
    const f = setup();
    let entered: () => void = () => {}, canceled = false;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const run = async (_input: Parameters<typeof inferParallelMlSignal>[0], signal?: AbortSignal) => {
      void _input; entered();
      return await new Promise<ReturnType<typeof inferParallelMlSignal>>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { canceled = true; reject(new Error('research_budget_exhausted')); }, { once: true });
      });
    };
    const runtime = createMlSignalRuntime({ profileId: 'main', database: f.db, nowMs: () => f.clock.nowMs(),
      candleSource: { researchHourlyWindow: f.read } as unknown as ReturnType<typeof createHistoricalCoinbaseCandleSource>,
      worker: run, onUnexpectedError: vi.fn() });
    const refresh = runtime.refresh(NOW); await started;
    const execution = createRequestDeadline(() => NOW); await refresh; execution.dispose();
    expect(canceled).toBe(true);
    expect(runtime.current()).toMatchObject({ prediction: null, reason: 'research_budget_exhausted' });
    expect(f.events().some((event) => event.kind === 'ml_shadow_proposal')).toBe(false); f.db.close();
  });

  it('records a late-arriving shadow proposal while preserving operational events and the user pause', async () => {
    const f = setup(), runtime = f.create();
    const before = f.events(); await runtime.refresh(NOW);
    expect(runtime.current()).toMatchObject({ version: ML_INFERENCE_VERSION, predictedAtMs: NOW - 60_000, gate: 'unqualified' });
    expect(f.events().filter((event) => event.kind === 'ml_target')).toEqual(before.filter((event) => event.kind === 'ml_target'));
    expect(f.events().filter((event) => event.kind === 'ml_shadow_proposal')).toHaveLength(1);
    expect(f.events().some((event) => ['resumed', 'submit_attempt', 'external_order'].includes(event.kind))).toBe(false);
    expect(getMlSignalStudy('main', ML_SIGNAL_VERSION, f.db)).toBeNull();
    expect(f.db.prepare('SELECT count(*) AS n FROM ml_signal_studies_v1').get()).toEqual({ n: 0 });
    f.clock.set(NOW + 60_000); await f.create().refresh(f.clock.nowMs());
    expect(f.worker).toHaveBeenCalledTimes(1); // restart reuses the immutable same-slot record
    expect(f.events().filter((event) => event.kind === 'ml_shadow_proposal')).toHaveLength(1);
    f.db.close();
  });
  it('rejects a worker result arriving at the cutoff instead of marking a successful no-trade', async () => {
    const f = setup();
    const runtime = f.create(vi.fn(async (input) => {
      const result = inferParallelMlSignal(input); f.clock.set(NOW + 14 * 60_000); return result;
    }));
    await runtime.refresh(NOW);
    expect(runtime.current()).toMatchObject({ prediction: null, reason: 'shadow_worker_completed_late' });
    expect(f.events().some((event) => event.kind === 'ml_shadow_proposal')).toBe(false); f.db.close();
  });

  it('keeps an unfinished legacy ML holdout out of training without opening it', async () => {
    const f = setup();
    registerMlSignalStudy({ profileId: 'main', candidateVersion: ML_SIGNAL_VERSION, registeredAtMs: NOW - DAY,
      studyEndMs: NOW - DAY, datasetHash: sha256Hex('legacy'), planHash: sha256Hex('plan'), plan: { candidateCount: 1 } }, f.db);
    const runtime = f.create(); await runtime.refresh(NOW);
    expect(runtime.current()).toMatchObject({ prediction: null, reason: 'training_coverage_incomplete' });
    expect(getMlSignalStudy('main', ML_SIGNAL_VERSION, f.db)?.result).toBeNull(); f.db.close();
  });

  it('rejects mismatched provenance and does not evaluate or replace a frozen study result', async () => {
    const f = setup();
    registerMlSignalStudy({ profileId: 'main', candidateVersion: ML_SIGNAL_VERSION, registeredAtMs: NOW - DAY,
      studyEndMs: NOW - DAY, datasetHash: sha256Hex('legacy'), planHash: sha256Hex('plan'), plan: { candidateCount: 1 } }, f.db);
    const evidence = { developmentSlots: 300, holdoutSlots: 450, baselineReturnPct: 1, mlReturnPct: 1,
      liftPct: 0, stressLiftPct: 0, maxDrawdownPct: 1, turnover: 0, tradeCount: 0, lift95LowPct: 0, lift95HighPct: 0 };
    finishMlSignalStudy('main', ML_SIGNAL_VERSION, { gate: 'unqualified', evidence }, f.db);
    const before = canonicalJson(getMlSignalStudy('main', ML_SIGNAL_VERSION, f.db) as never);
    const runtime = f.create(vi.fn(async (input) => ({ ...inferParallelMlSignal(input), datasetHash: sha256Hex('wrong') })));
    await runtime.refresh(NOW);
    expect(runtime.current()).toMatchObject({ reason: 'shadow_worker_provenance_mismatch', prediction: null, evidence });
    expect(canonicalJson(getMlSignalStudy('main', ML_SIGNAL_VERSION, f.db) as never)).toBe(before); f.db.close();
  });

  it('retains complete per-asset progress when a later asset fails within the shared budget', async () => {
    const f = setup();
    const from = NOW - 60_000 - 48 * HOUR, to = NOW - 60_000;
    f.db.prepare('DELETE FROM ml_signal_hourly_bars_v1 WHERE start_ms>=?').run(from);
    let ltcReady = false;
    const reads: string[] = [];
    const source = { researchHourlyWindow: async (instrument: { productId: string }, start: number, end: number) => {
      reads.push(instrument.productId);
      if (instrument.productId === 'LTC-USD' && !ltcReady) return { ok: false as const };
      return { ok: true as const, source: 'public' as const,
        bars: f.bars.filter((bar) => bar.productId === instrument.productId && bar.startTimeMs >= start && bar.startTimeMs < end)
          .map((bar) => ({ ...bar, interval: '1h' as const, endTimeMs: bar.startTimeMs + HOUR, isComplete: true as const })) };
    } } as unknown as ReturnType<typeof createHistoricalCoinbaseCandleSource>;
    const runtime = createMlSignalRuntime({ profileId: 'main', database: f.db, nowMs: () => f.clock.nowMs(),
      candleSource: source, worker: f.worker, onUnexpectedError: vi.fn() });
    await runtime.refresh(NOW);
    expect(runtime.current()?.prediction).toBeNull(); expect(f.worker).not.toHaveBeenCalled();
    expect(listMlHourlyBars('main', from, to, f.db)).toHaveLength(96);
    ltcReady = true; await runtime.refresh(NOW);
    expect(reads).toEqual(['BTC-USD', 'ETH-USD', 'LTC-USD', 'LTC-USD']);
    expect(runtime.current()?.predictedAtMs).toBe(to); f.db.close();
  });

  it('prioritizes the latest missing hour and refuses an incomplete source response', async () => {
    const f = setup();
    f.db.prepare('DELETE FROM ml_signal_hourly_bars_v1 WHERE product_id=? AND start_ms=?').run('LTC-USD', NOW - 60_000 - HOUR);
    const runtime = f.create(); await runtime.refresh(NOW);
    expect(f.read).toHaveBeenCalled();
    const args = f.read.mock.calls as unknown as [unknown, number, number][];
    expect(args[0]?.[1]).toBe(NOW - 60_000 - 48 * HOUR); expect(args[0]?.[2]).toBe(NOW - 60_000);
    expect(runtime.current()).toMatchObject({ prediction: null, reason: 'recent_hour_collection_incomplete' });
    expect(f.worker).not.toHaveBeenCalled(); f.db.close();
  });
});
