import { studyCollection } from '@coqui/services';
import type { Clock } from '@coqui/core';
import { evaluateBreakoutSlot, evaluateUniverseAsset,
  instrumentKey, mapUniverseProducts, planUniverseShadow, UNIVERSE_DAY, universeHash,
  WIDER_UNIVERSE_POLICY, type DynamicUniverseSlot, type UniversePolicy } from '@coqui/core';
import { appendBreakoutRecord, getSetting, latestParallelExperiment, listBreakoutHourlyBars,
  listBreakoutRecords, listParallelEvents, listUniverseRecords, parallelExperimentStatus,
  saveBreakoutHourlyBars, type Db } from '@coqui/storage';
import type { createHistoricalCoinbaseCandleSource } from './coinbase-candle-source.js';
import { widerUniverseRuntimeSourceHash } from './wider-universe-runtime.js';

const HOUR = 3_600_000;
const HISTORY_HOURS = 720;
const PAGE_HOURS = 300;

/** Runs after the operational paper pass and has no broker client or submission method. */
export function createBreakoutRuntime(input: { profileId: string; database: Db; clock: Clock;
  candleSource: ReturnType<typeof createHistoricalCoinbaseCandleSource>;
  onUnexpectedError: (context: string, error: unknown) => void;
  sourceContentHash?: string }) {
  let busy = false, cursor = 0, sourceHash: string | null = null;
  const legacyRecord = (kind: 'study' | 'shadow' | 'failure', key: string, body: unknown) =>
    appendBreakoutRecord(input.profileId, { kind, key, atMs: input.clock.nowMs(), body }, input.database);
  let failureRecord: (kind: 'study' | 'shadow' | 'failure', key: string, body: unknown) => unknown = legacyRecord;
  return { async refresh(): Promise<void> {
    if (busy) return;
    busy = true;
    failureRecord = legacyRecord;
    try {
      const nowMs = input.clock.nowMs();
      const experiment = latestParallelExperiment(input.profileId, input.database);
      if (!experiment || parallelExperimentStatus(listParallelEvents(experiment.id, input.profileId, input.database)) === 'stopped') return;
      sourceHash ??= input.sourceContentHash ?? widerUniverseRuntimeSourceHash();
      const scoped = studyCollection({ profileId: input.profileId, experimentId: experiment.id,
        candidateId: 'wider-breakout-v1', db: input.database, nowMs, legacyHash: sourceHash,
        legacyList: (kind) => listBreakoutRecords(input.profileId, kind as 'study' | 'shadow' | 'failure', input.database),
        legacyAppend: (kind,key,body) => legacyRecord(kind as 'study' | 'shadow' | 'failure',key,body) });
      if (!scoped.ready) return;
      const record = scoped.append;
      failureRecord = (kind,key,body) => scoped.append(kind,key,body);
      const scopedRecords = (_profile: string, kind: 'study' | 'shadow' | 'failure', _db: Db,
        beforeExclusiveMs = Number.MAX_SAFE_INTEGER) => scoped.list(kind).filter((r) => r.atMs < beforeExclusiveMs);
      const rawPolicy = getSetting('research.widerUniverse.policy', input.database);
      const policy: UniversePolicy = rawPolicy === null ? WIDER_UNIVERSE_POLICY : JSON.parse(rawPolicy) as UniversePolicy;
      const policyHash = universeHash(policy);
      const catalogs = listUniverseRecords(input.profileId, 'catalog', input.database,
        Number.MAX_SAFE_INTEGER, (Math.floor(nowMs / UNIVERSE_DAY) - 1) * UNIVERSE_DAY);
      const catalog = catalogs.at(-1);
      if (catalog) {
        const body = catalog.body as { products: Parameters<typeof mapUniverseProducts>[0];
          assets: Parameters<typeof mapUniverseProducts>[1] };
        const mapped = mapUniverseProducts(body.products, body.assets).filter((item) => item.mapping !== null);
        if (mapped.length) {
          const completeHour = Math.floor(nowMs / HOUR) * HOUR;
          const work: { item: (typeof mapped)[number]; assetId: string; from: number; to: number }[] = [];
          for (let attempt = 0; attempt < mapped.length; attempt += 1) {
            const item = mapped[cursor++ % mapped.length]!;
            const assetId = instrumentKey(item.product.instrument);
            const start = completeHour - HISTORY_HOURS * HOUR;
            const stored = listBreakoutHourlyBars(input.profileId, assetId, start, completeHour,
              Number.MAX_SAFE_INTEGER, input.database);
            const present = new Set(stored.map((bar) => bar.startTimeMs));
            let to = completeHour;
            while (to > start && present.has(to - HOUR)) to -= HOUR;
            if (to === start) continue;
            let from = to - HOUR;
            while (from > start && to - from < PAGE_HOURS * HOUR && !present.has(from - HOUR)) from -= HOUR;
            work.push({ item, assetId, from, to });
            if (work.length === 4) break;
          }
          await Promise.all(work.map(async ({ item, assetId, from, to }) => {
            const result = await input.candleSource.researchHourlyWindow(item.product.instrument,
              from, to, input.clock.nowMs());
            if (!result.ok) return;
            const expected = (to - from) / HOUR;
            const unique = new Set(result.bars.map((bar) => bar.startTimeMs));
            if (result.bars.length !== expected || unique.size !== expected ||
                !Array.from({ length: expected }, (_, i) => from + i * HOUR).every((t) => unique.has(t)) ||
                !result.bars.every((bar) => bar.productId === item.product.instrument.productId &&
                  bar.interval === '1h' && bar.isComplete && bar.endTimeMs === bar.startTimeMs + HOUR)) return;
            const retrievedAtMs = input.clock.nowMs();
            saveBreakoutHourlyBars(input.profileId, result.bars.map((bar) => ({
              assetId, startTimeMs: bar.startTimeMs, open: bar.open, high: bar.high,
              low: bar.low, close: bar.close, volume: bar.volume, source: result.source, retrievedAtMs,
            })), input.database);
          }));
        }
      }
      const existingStudy = scopedRecords(input.profileId, 'study', input.database)
        .find((row) => (row.body as { policyHash?: string }).policyHash === policyHash);
      if (!existingStudy) { record('failure', `policy_changed:${Math.floor(nowMs/14_400_000)}`,
        { reason: 'registered_policy_changed', executionEnabled: false }); return; }
      const slotMs = Math.floor(nowMs / (4 * HOUR)) * (4 * HOUR);
      if (![4, 8, 12, 16, 20].includes(new Date(slotMs).getUTCHours()) || nowMs >= slotMs + 900_000 ||
          scopedRecords(input.profileId, 'shadow', input.database).some((r) => r.key === String(slotMs))) return;
      const frame = listUniverseRecords(input.profileId, 'frame', input.database,
        Number.MAX_SAFE_INTEGER, slotMs).find((r) => r.key === String(slotMs));
      if (!frame) return;
      const slot = frame.body as DynamicUniverseSlot;
      const previous = scopedRecords(input.profileId, 'shadow', input.database, slotMs)
        .filter((r) => {
          const body = r.body as { portfolio?: unknown; policyHash?: string };
          return body.portfolio !== undefined && body.policyHash === policyHash;
        }).at(-1);
      const portfolio = (previous?.body as { portfolio?: { cash: string; quantities: Record<string, string> } } | undefined)
        ?.portfolio ?? { cash: '100000', quantities: {} };
      const heldAssetIds = Object.entries(portfolio.quantities).filter(([, qty]) => Number(qty) > 0).map(([id]) => id);
      const assets = slot.observations.filter((o) => o.evidence.mapping !== null).map((observation) => {
        const evidence = observation.evidence, assetId = instrumentKey(evidence.product.instrument);
        const quote = evidence.alpaca;
        return { assetId, eligibility: evaluateUniverseAsset(evidence, observation.atMs, policy),
          hourlyBars: listBreakoutHourlyBars(input.profileId, assetId, slotMs - HISTORY_HOURS * HOUR,
            slotMs, observation.atMs, input.database),
          quote: quote === null ? null : { bid: quote.bid, ask: quote.ask, atMs: quote.quoteAtMs },
          observedAtMs: observation.atMs };
      });
      const decision = evaluateBreakoutSlot({ slotMs, assets, heldAssetIds });
      try {
        const step = planUniverseShadow(slot, decision.weights, portfolio, policy);
        record('shadow', String(slotMs), { ...decision, policyHash, frameHash: frame.hash,
          studyInstanceId: scoped.namespace, studyKey: `wider-breakout-v1:${policyHash}`, portfolio: step.portfolio,
          planning: step, desiredExits: decision.desiredExits,
          blockedExits: decision.desiredExits.filter((id) => !step.orders.some((o) => o.assetId === id && o.side === 'sell')) });
      } catch {
        record('shadow', String(slotMs), { ...decision, policyHash, frameHash: frame.hash,
          studyInstanceId: scoped.namespace, studyKey: `wider-breakout-v1:${policyHash}`, portfolio,
          planning: { status: 'blocked', reason: 'virtual_execution_evidence_unavailable' },
          blockedExits: decision.desiredExits });
      }
    } catch (error) {
      input.onUnexpectedError('breakout_research', error);
      try { failureRecord('failure', String(Math.floor(input.clock.nowMs() / 60_000)),
        { reason: 'breakout_collection_or_shadow_failed', executionEnabled: false }); }
      catch { /* The host error reporter received the original failure. */ }
    } finally { busy = false; }
  } };
}
