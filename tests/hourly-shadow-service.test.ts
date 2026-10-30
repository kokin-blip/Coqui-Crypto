import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, FixedClock, HOURLY_EXECUTION_V1, profileConnectionV2, sha256Hex } from '../packages/core/src/index.js';
import { HourlyShadowService, PARALLEL_INSTRUMENTS, parallelAnchor } from '../packages/services/src/index.js';
import { hourlyShadowStatus } from '../packages/services/src/paper/parallel-hourly-shadow.js';
import { previewHourlyStudy, restartHourlyStudy } from '../packages/services/src/paper/restart-hourly-study.js';
import { appendHourlyExecutionRecord, appendParallelEvent, assignAuthoritativeHost, listParallelEvents, listRemediationEvidence,
  listStudyInstances, openDatabase, relinquishAuthoritativeHost, saveParallelExperiment, saveProfileConnectionV2 } from '../packages/storage/src/index.js';
import { createHourlyStudyHandlers } from '../apps/desktop/src/main/hourly-study-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { createProfileOperationGate } from '../packages/services/src/index.js';
import { paperPreparation } from './support.js';

const DAY = 86400000, START = Date.UTC(2026, 9, 22), EXPERIMENT = sha256Hex('hourly-test');
function fixture() {
  const db = openDatabase(':memory:'), clock = new FixedClock(START - 60000);
  const connection = profileConnectionV2('main', 'coinbase', sha256Hex('fixture'), START - DAY);
  saveProfileConnectionV2(connection, db);
  const snapshot = sha256Hex('snapshot');
  db.prepare('INSERT INTO connection_account_snapshots_v2 VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    snapshot, 'main', connection.id, 'coinbase', START - DAY, 1, 'healthy', '{}', sha256Hex('content'), START - DAY);
  const preparation = () => paperPreparation(PARALLEL_INSTRUMENTS, Math.floor(clock.nowMs() / DAY) * DAY - DAY);
  saveParallelExperiment({ id: EXPERIMENT, profileId: 'main', sourceConnectionSnapshotId: snapshot,
    alpacaAccountId: 'paper-fixture', openingCoquiCash: '1000', openingAlpacaCash: '100000', openingAlpacaEquity: '100000',
    anchor: parallelAnchor(preparation().dataset), startedAt: START - DAY, configVersion: 'fixture' }, db);
  const append = (kind: string) => appendParallelEvent({ profileId: 'main', experimentId: EXPERIMENT, kind,
    key: `${kind}:${clock.nowMs()}`, at: clock.nowMs(), detail: { reason: 'broker_positions_mismatch' } }, db);
  append('started'); append('paused');
  appendHourlyExecutionRecord('main', { kind: 'study', key: HOURLY_EXECUTION_V1.id, atMs: START - DAY,
    body: { startMs: START - DAY, foldEndsMs: [START + 29 * DAY, START + 59 * DAY, START + 89 * DAY],
      holdoutEndMs: START + 119 * DAY, planHash: sha256Hex(canonicalJson(HOURLY_EXECUTION_V1)), sourceHash: sha256Hex('old') } }, db);
  appendHourlyExecutionRecord('main', { kind: 'observation', key: 'legacy', atMs: START - DAY, body: {} }, db);
  const input = () => ({ profileId: 'main', db, nowMs: clock.nowMs(), artifactHash: sha256Hex('artifact') });
  const instance = () => listStudyInstances('main', HOURLY_EXECUTION_V1.id, db).at(-1)!;
  const records = (kind = 'observation') => listRemediationEvidence('main', instance().id, kind, db);
  const submit = vi.fn(), positions = vi.fn(async () => [{ symbol: 'BTCUSD', qty: '999', market_value: '999' }]);
  const quote = vi.fn(async () => ({ quotes: Object.fromEntries(['BTC', 'ETH', 'LTC'].map(symbol =>
    [`${symbol}/USD`, { bp: 100, ap: 101, t: new Date(clock.nowMs()).toISOString() }])) }));
  const read = { account: vi.fn(async () => ({ id: 'paper-fixture', currency: 'USD', cash: '1', equity: '1', status: 'PAPER_ONLY',
    trading_blocked: false, account_blocked: false })), positions, asset: vi.fn(async (symbol: string) => ({ symbol, tradable: true,
    status: 'active', min_order_size: '0.001', min_trade_increment: '0.001' })), latestCryptoQuotes: quote, submit };
  let killed = false;
  const dependencies = { profileId: 'main', hostId: 'desktop-fixture', hostKind: 'desktop' as const, database: db, clock,
    refresh: vi.fn(async () => preparation()), readClient: vi.fn(async () => read), killSwitchEngaged: () => killed };
  const service = new HourlyShadowService(dependencies);
  return { db, clock, input, instance, records, read, submit, append, service, dependencies, kill: () => { killed = true; } };
}
afterEach(() => vi.useRealTimers());
describe('prospective hourly registration', () => {
  it('previews and registers through IPC without changing broker activation or historical rows', async () => {
    const f = fixture(), gate = createProfileOperationGate();
    assignAuthoritativeHost('main', 'desktop-fixture', 'desktop', f.clock.nowMs(), f.db);
    const dispatch = createDispatcher({ handlers: createHourlyStudyHandlers({ profileId: 'main', hostId: 'desktop-fixture',
      database: f.db, clock: f.clock, operationGate: gate, artifactHash: () => sha256Hex('artifact') }) });
    const before = listParallelEvents(EXPERIMENT, 'main', f.db);
    const preview = await dispatch('parallel.paper.hourly-study.preview', {});
    expect(preview.status).toBe('ok');
    const hash = (preview as { value: { previewHash: string; startMs: number } }).value;
    expect(hash.startMs).toBe(START);
    const payload = { commandId: crypto.randomUUID(), previewHash: hash.previewHash };
    gate.begin();
    expect((await dispatch('parallel.paper.hourly-study.restart', payload)).status).toBe('blocked');
    gate.end();
    const result = await dispatch('parallel.paper.hourly-study.restart', payload);
    expect(result.status).toBe('ok');
    expect(await dispatch('parallel.paper.hourly-study.restart', payload)).toEqual(result);
    expect(listStudyInstances('main', HOURLY_EXECUTION_V1.id, f.db)).toHaveLength(1);
    expect(listParallelEvents(EXPERIMENT, 'main', f.db)).toEqual(before);
    expect(f.db.prepare("SELECT count(*) n FROM hourly_execution_records_v1 WHERE kind='observation'").get()).toMatchObject({ n: 1 });
    expect(hourlyShadowStatus('main', f.db, f.clock.nowMs())).toMatchObject({ registrationState: 'scheduled', observationCount: 0 });
    f.clock.advanceBy(60000);
    expect(hourlyShadowStatus('main', f.db, f.clock.nowMs()).registrationState).toBe('collecting');
    f.clock.advanceBy(120 * DAY);
    expect(hourlyShadowStatus('main', f.db, f.clock.nowMs()).registrationState).toBe('ended');
    f.db.close();
  });
  it.each(['artifact', 'midnight', 'registration', 'stopped'])('rejects a preview made stale by %s', changed => {
    const f = fixture(), preview = previewHourlyStudy(f.input());
    let input = f.input();
    if (changed === 'artifact') input = { ...input, artifactHash: sha256Hex('different') };
    if (changed === 'midnight') { f.clock.advanceBy(60000); input = f.input(); }
    if (changed === 'registration') restartHourlyStudy(input);
    if (changed === 'stopped') f.append('stopped');
    expect(() => restartHourlyStudy({ ...input, previewHash: preview.previewHash, commandId: crypto.randomUUID() }))
      .toThrow(changed === 'stopped' ? 'experiment_not_active' : 'hourly_study_preview_stale');
    f.db.close();
  });
});
describe('independent read-only hourly lane', () => {
  it('collects with fee-paused broker quantities without using them as the virtual opening, and never backfills', async () => {
    const f = fixture(); restartHourlyStudy(f.input());
    await f.service.tick(); expect(f.dependencies.refresh).not.toHaveBeenCalled();
    f.clock.advanceBy(61000); const before = listParallelEvents(EXPERIMENT, 'main', f.db);
    await f.service.tick(); await f.service.tick();
    expect(f.records()).toHaveLength(1); expect(f.records('shadow')).toHaveLength(1);
    expect(f.read.latestCryptoQuotes).toHaveBeenCalledTimes(1);
    expect(f.dependencies.refresh).toHaveBeenCalledTimes(1); expect(f.read.account).toHaveBeenCalledTimes(1);
    expect(f.read.positions).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    expect(f.records()[0]?.body).toMatchObject({ opening: { cash: 100000, quantities: [0, 0, 0] } });
    expect(listParallelEvents(EXPERIMENT, 'main', f.db)).toEqual(before);
    f.clock.advanceBy(2 * 3600000 + 15 * 60000); await f.service.tick(); expect(f.records()).toHaveLength(1);
    f.clock.advanceBy(45 * 60000); await f.service.tick();
    expect(f.records()).toHaveLength(2); // Only the current eligible hour, no intervening slots.
    f.db.close();
  });
  it.each(['suspend', 'stop', 'authority', 'kill', 'deadline', 'new-experiment'])('fences late quotes after %s, including failure appends', async changed => {
    const f = fixture(); restartHourlyStudy(f.input()); f.clock.advanceBy(60000);
    let finish!: (value: Awaited<ReturnType<typeof f.read.latestCryptoQuotes>>) => void;
    const quoteValue = await f.read.latestCryptoQuotes(); f.read.latestCryptoQuotes.mockClear();
    f.read.latestCryptoQuotes.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = f.service.tick(); expect(f.service.tick()).toBe(first);
    await vi.waitFor(() => expect(f.read.latestCryptoQuotes).toHaveBeenCalledOnce(), { interval: 1 });
    if (changed === 'suspend') f.service.suspend();
    if (changed === 'stop') f.append('stopped');
    if (changed === 'kill') f.kill();
    if (changed === 'deadline') f.clock.advanceBy(10001);
    if (changed === 'authority') assignAuthoritativeHost('main', 'other-host', 'desktop', f.clock.nowMs(), f.db);
    if (changed === 'new-experiment') {
      const original = f.db.prepare('SELECT * FROM parallel_paper_experiments_v1').get()!;
      f.db.prepare('INSERT INTO parallel_paper_experiments_v1 VALUES (?,?,?,?,?,?,?,?,?,?)').run(
        sha256Hex('new-experiment'), 'main', original['source_connection_snapshot_id'] as string, 'paper-fixture',
        '1000', '100000', '100000', '{}', f.clock.nowMs() + 1, 'fixture');
    }
    finish(quoteValue); await first;
    expect(f.records()).toHaveLength(0); expect(f.records('failure')).toHaveLength(0);
    expect(f.submit).not.toHaveBeenCalled(); f.db.close();
  });
  it('releases a hung preparation at its deadline and permits a later pass', async () => {
    vi.useFakeTimers();
    const f = fixture(); restartHourlyStudy(f.input()); f.clock.advanceBy(60000);
    let finish!: () => void;
    f.dependencies.refresh.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ok: false, code: 'market_fetch_failed' } as never); }));
    const first = f.service.tick(); await vi.advanceTimersByTimeAsync(10001); await first;
    expect(f.records()).toHaveLength(0); finish(); await Promise.resolve();
    await f.service.tick(); expect(f.records()).toHaveLength(1); f.db.close();
  });
  it.each(['stale-quotes', 'missing-bars', 'wrong-day', 'wrong-account'])('rejects %s without financial actions', async invalid => {
    const f = fixture(); restartHourlyStudy(f.input()); f.clock.advanceBy(60000);
    if (invalid === 'stale-quotes') f.read.latestCryptoQuotes.mockImplementation(async () => ({ quotes:
      Object.fromEntries(['BTC', 'ETH', 'LTC'].map(symbol => [`${symbol}/USD`, { bp: 100, ap: 101, t: new Date(START - 120000).toISOString() }])) }));
    if (invalid === 'missing-bars') f.dependencies.refresh.mockResolvedValue({ ok: false, code: 'market_fetch_failed' } as never);
    if (invalid === 'wrong-day') {
      const old = paperPreparation(PARALLEL_INSTRUMENTS, START - 2 * DAY);
      f.dependencies.refresh.mockResolvedValue(old);
    }
    if (invalid === 'wrong-account') f.read.account.mockResolvedValue({ ...(await f.read.account()), id: 'other-account' });
    await f.service.tick(); expect(f.records()).toHaveLength(0); expect(f.submit).not.toHaveBeenCalled(); f.db.close();
  });
  it('never journals provider exception text that could contain credentials', async () => {
    const f = fixture(); restartHourlyStudy(f.input()); f.clock.advanceBy(60000);
    f.dependencies.readClient.mockRejectedValue(new Error('private_credential_value'));
    await f.service.tick();
    expect(f.records('failure')[0]?.body).toMatchObject({ reason: 'hourly_shadow_unavailable' });
    expect(JSON.stringify(f.records('failure'))).not.toContain('private_credential_value');
    f.db.close();
  });
  it.each(['desktop', 'headless'] as const)('does not collect under relinquished %s ownership', async hostKind => {
    const f = fixture(); restartHourlyStudy(f.input()); f.clock.advanceBy(60000);
    assignAuthoritativeHost('main', 'desktop-fixture', 'desktop', START, f.db);
    relinquishAuthoritativeHost('main', 'desktop-fixture', 1, START + 1, f.db);
    const service = new HourlyShadowService({ ...f.dependencies, hostKind });
    await service.tick(); expect(f.dependencies.refresh).not.toHaveBeenCalled(); f.db.close();
  });
});
