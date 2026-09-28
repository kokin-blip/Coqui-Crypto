import type { Clock } from '@coqui/core';
import { createRangeRotationStudy, evaluateRangeRotationSlot, evaluateUniverseAsset,
  instrumentKey, markRangePortfolio, planRangeRotationShadow, RANGE_ROTATION_VERSION, UNIVERSE_DAY,
  universeHash, WIDER_UNIVERSE_POLICY, type DynamicUniverseSlot,
  type UniversePolicy } from '@coqui/core';
import { appendRangeRotationRecord, getSetting, latestParallelExperiment,
  listBreakoutHourlyBars, listParallelEvents, listRangeRotationRecords,
  listUniverseRecords, parallelExperimentStatus, type Db } from '@coqui/storage';
import { widerUniverseRuntimeSourceHash } from './wider-universe-runtime.js';

const HOUR = 3_600_000;

/** Reads existing research evidence after breakout collection; has no submission capability. */
export function createRangeRotationRuntime(input: { profileId: string; database: Db; clock: Clock;
  onUnexpectedError: (context: string, error: unknown) => void; sourceContentHash?: string }) {
  let busy = false, sourceHash: string | null = null;
  const record = (kind: 'study' | 'shadow' | 'failure', key: string, body: unknown) =>
    appendRangeRotationRecord(input.profileId, { kind, key, atMs: input.clock.nowMs(), body }, input.database);
  return { async refresh(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const nowMs = input.clock.nowMs();
      const experiment = latestParallelExperiment(input.profileId, input.database);
      if (!experiment || parallelExperimentStatus(listParallelEvents(experiment.id, input.profileId, input.database)) === 'stopped') return;
      const rawPolicy = getSetting('research.widerUniverse.policy', input.database);
      const policy: UniversePolicy = rawPolicy === null ? WIDER_UNIVERSE_POLICY : JSON.parse(rawPolicy) as UniversePolicy;
      const policyHash = universeHash(policy);
      const studies = listRangeRotationRecords(input.profileId, 'study', input.database);
      if (!studies.some((s) => (s.body as { policyHash?: string }).policyHash === policyHash)) {
        sourceHash ??= input.sourceContentHash ?? widerUniverseRuntimeSourceHash();
        record('study', `${RANGE_ROTATION_VERSION}:${policyHash}`,
          createRangeRotationStudy(nowMs, sourceHash, policy, experiment.anchor));
      }
      const slotMs = Math.floor(nowMs / (4 * HOUR)) * (4 * HOUR);
      if (![4, 8, 12, 16, 20].includes(new Date(slotMs).getUTCHours()) || nowMs >= slotMs + 900_000 ||
          listRangeRotationRecords(input.profileId, 'shadow', input.database)
            .some((r) => r.key === String(slotMs))) return;
      const frame = listUniverseRecords(input.profileId, 'frame', input.database,
        Number.MAX_SAFE_INTEGER, slotMs).find((r) => r.key === String(slotMs));
      if (!frame) return;
      const slot = frame.body as DynamicUniverseSlot;
      const prior = listRangeRotationRecords(input.profileId, 'shadow', input.database, slotMs)
        .filter((r) => (r.body as { policyHash?: string }).policyHash === policyHash).at(-1);
      const priorBody = prior?.body as { portfolio?: { cash: string; quantities: Record<string, string> };
        dayStartEquity?: string; dailyTurnoverUsd?: string; planning?: { equity?: string };
        qualifiedIds?: string[]; replacementIds?: string[]; slotMs?: number } | undefined;
      const portfolio = priorBody?.portfolio ?? { cash: '100000', quantities: {} };
      const sameDay = priorBody?.slotMs !== undefined &&
        Math.floor(priorBody.slotMs / UNIVERSE_DAY) === Math.floor(slotMs / UNIVERSE_DAY);
      const dayStartEquity = sameDay ? priorBody.dayStartEquity ?? null : null;
      const dailyTurnoverUsd = sameDay ? priorBody.dailyTurnoverUsd ?? '0' : '0';
      const heldAssetIds = Object.entries(portfolio.quantities)
        .filter(([, qty]) => Number(qty) > 0).map(([id]) => id);
      const assets = slot.observations.filter((o) => o.evidence.mapping !== null).map((o) => {
        const assetId = instrumentKey(o.evidence.product.instrument), quote = o.evidence.alpaca;
        return { assetId, eligibility: evaluateUniverseAsset(o.evidence, o.atMs, policy),
          hourlyBars: listBreakoutHourlyBars(input.profileId, assetId,
            slotMs - 720 * HOUR, slotMs, o.atMs, input.database),
          quote: quote === null ? null : { bid: quote.bid, ask: quote.ask, atMs: quote.quoteAtMs },
          observedAtMs: o.atMs };
      });
      const decision = evaluateRangeRotationSlot({ slotMs, assets, heldAssetIds,
        previousSlotMs: priorBody?.slotMs ?? null,
        previousQualifiedIds: priorBody?.qualifiedIds ?? [],
        previousReplacementIds: priorBody?.replacementIds ?? [] });
      try {
        const referenceEquity = dayStartEquity ?? markRangePortfolio(slot, portfolio).equity;
        const step = planRangeRotationShadow(slot, decision, portfolio, referenceEquity,
          dailyTurnoverUsd, policy);
        record('shadow', String(slotMs), { ...decision, policyHash, frameHash: frame.hash,
          studyKey: `${RANGE_ROTATION_VERSION}:${policyHash}`, portfolio: step.portfolio,
          planning: step, dayStartEquity: referenceEquity, dailyTurnoverUsd: step.dailyTurnoverUsd });
      } catch {
        record('shadow', String(slotMs), { ...decision, policyHash, frameHash: frame.hash,
          studyKey: `${RANGE_ROTATION_VERSION}:${policyHash}`, portfolio, dayStartEquity,
          dailyTurnoverUsd, planning: { status: 'blocked', reason: 'virtual_execution_evidence_unavailable' },
          blockedExits: decision.desiredExits });
      }
    } catch (error) {
      input.onUnexpectedError('range_rotation_research', error);
      try { record('failure', String(Math.floor(input.clock.nowMs() / 60_000)),
        { reason: 'range_rotation_shadow_failed', executionEnabled: false }); }
      catch { /* Original error already went to the host reporter. */ }
    } finally { busy = false; }
  } };
}
