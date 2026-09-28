import type { Clock } from '@coqui/core';
import { createMarketSelectorStudy, evaluateMarketSelectorSlot, evaluateUniverseAsset,
  instrumentKey, markRangePortfolio, MARKET_SELECTOR_VERSION, planRangeRotationShadow,
  planUniverseShadow, UNIVERSE_DAY, universeHash, universeStrategyInput,
  WIDER_UNIVERSE_POLICY, type DynamicUniverseSlot, type SelectorPrevious,
  type SelectorPendingOrder, type UniversePolicy, type UniversePortfolio } from '@coqui/core';
import { appendMarketSelectorRecord, getSetting, latestParallelExperiment,
  listBreakoutHourlyBars, listMarketSelectorRecords, listParallelEvents, listUniverseRecords,
  parallelExperimentStatus, type Db } from '@coqui/storage';
import { widerUniverseRuntimeSourceHash } from './wider-universe-runtime.js';

const HOUR = 3_600_000;
type ShadowBody = SelectorPrevious & { policyHash: string; portfolio: UniversePortfolio;
  pending: readonly SelectorPendingOrder[]; dayStartEquity: string | null;
  dailyTurnoverUsd: string; frameHash: string;
  candidates?: { trendvol?: { available: boolean; target: Readonly<Record<string, number>> | null } } };

/** Research-only evaluator. All venue evidence is read from the recorded frame. */
export function createMarketSelectorRuntime(input: { profileId: string; database: Db; clock: Clock;
  onUnexpectedError: (context: string, error: unknown) => void; sourceContentHash?: string }) {
  let busy = false, sourceHash: string | null = null;
  const record = (kind: 'study' | 'shadow' | 'failure', key: string, body: unknown) =>
    appendMarketSelectorRecord(input.profileId, { kind, key, atMs: input.clock.nowMs(), body }, input.database);
  return { async refresh(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const nowMs = input.clock.nowMs();
      const experiment = latestParallelExperiment(input.profileId, input.database);
      if (!experiment || parallelExperimentStatus(listParallelEvents(experiment.id,
        input.profileId, input.database)) === 'stopped') return;
      const rawPolicy = getSetting('research.widerUniverse.policy', input.database);
      const policy: UniversePolicy = rawPolicy === null ? WIDER_UNIVERSE_POLICY : JSON.parse(rawPolicy) as UniversePolicy;
      const policyHash = universeHash(policy);
      sourceHash ??= input.sourceContentHash ?? widerUniverseRuntimeSourceHash();
      const existingStudy = listMarketSelectorRecords(input.profileId, 'study', input.database)
        .find((item) => (item.body as { policyHash?: string }).policyHash === policyHash);
      if (!existingStudy) {
        record('study', `${MARKET_SELECTOR_VERSION}:${policyHash}`,
          createMarketSelectorStudy(nowMs, sourceHash, policy, experiment.anchor));
      }
      const slotMs = Math.floor(nowMs / (4 * HOUR)) * (4 * HOUR);
      if (nowMs >= slotMs + 900_000 || listMarketSelectorRecords(input.profileId, 'shadow', input.database)
        .some((item) => item.key === String(slotMs))) return;
      if (existingStudy && (existingStudy.body as { sourceContentHash: string }).sourceContentHash !== sourceHash) {
        if (!listMarketSelectorRecords(input.profileId, 'failure', input.database)
          .some((item) => item.key === `source_changed:${slotMs}`))
          record('failure', `source_changed:${slotMs}`,
            { slotMs, reason: 'registered_selector_source_changed', executionEnabled: false });
        return;
      }
      const frame = listUniverseRecords(input.profileId, 'frame', input.database,
        Number.MAX_SAFE_INTEGER, slotMs).find((item) => item.key === String(slotMs));
      if (!frame) {
        if (!listMarketSelectorRecords(input.profileId, 'failure', input.database)
          .some((item) => item.key === `missing_frame:${slotMs}`))
          record('failure', `missing_frame:${slotMs}`,
            { slotMs, reason: 'point_in_time_universe_missing', executionEnabled: false });
        return;
      }
      const slot = frame.body as DynamicUniverseSlot;
      const previous = listMarketSelectorRecords(input.profileId, 'shadow', input.database, slotMs)
        .filter((item) => (item.body as { policyHash?: string }).policyHash === policyHash).at(-1)?.body as
          ShadowBody | undefined;
      const portfolio: UniversePortfolio = previous?.portfolio ?? { cash: '100000', quantities: {} };
      const pending = previous?.pending ?? [];
      const heldAssetIds = Object.entries(portfolio.quantities).filter(([, qty]) => Number(qty) > 0)
        .map(([id]) => id);
      const assets = slot.observations.filter((o) => o.evidence.mapping !== null).map((o) => {
        const assetId = instrumentKey(o.evidence.product.instrument), quote = o.evidence.alpaca;
        return { assetId, eligibility: evaluateUniverseAsset(o.evidence, o.atMs, policy),
          hourlyBars: listBreakoutHourlyBars(input.profileId, assetId,
            slotMs - 720 * HOUR, slotMs, o.atMs, input.database),
          quote: quote === null ? null : { bid: quote.bid, ask: quote.ask, atMs: quote.quoteAtMs },
          observedAtMs: o.atMs };
      });
      const sameDay = previous !== undefined && Math.floor(previous.slotMs / UNIVERSE_DAY) ===
        Math.floor(slotMs / UNIVERSE_DAY);
      let baselineTarget: Readonly<Record<string, number>> | null = sameDay &&
        previous.candidates?.trendvol?.available ? previous.candidates.trendvol.target : null;
      if (baselineTarget === null) {
        try { baselineTarget = universeStrategyInput(slot, experiment.anchor, policy).baselineTargets; }
        catch { /* Daily evidence unavailable: pure selector chooses cash if needed. */ }
      }
      const decision = evaluateMarketSelectorSlot({ slotMs, assets, heldAssetIds,
        baselineTarget, previous: previous ?? null });
      let dayStartEquity = sameDay ? previous.dayStartEquity : null;
      if (dayStartEquity === null) {
        try { dayStartEquity = markRangePortfolio(slot, portfolio).equity; }
        catch { /* A missing mark blocks planning, not the decision record. */ }
      }
      let dailyTurnoverUsd = sameDay ? previous.dailyTurnoverUsd : '0';
      let nextPortfolio = portfolio;
      let planning: unknown = { status: 'target_recorded', reason: 'midnight_carry' };
      if (pending.length) planning = { status: 'pending_virtual_reconciliation', pendingIds: pending.map((p) => p.id) };
      else if (decision.virtualExecutionAllowed) {
        try {
          if (decision.selected === 'range_rotation' && dayStartEquity === null)
            throw new Error('missing_virtual_day_mark');
          const step = decision.selected === 'range_rotation' && decision.candidates.range_rotation.available ?
            planRangeRotationShadow(slot, { weights: decision.target,
              desiredExits: decision.candidates.range_rotation.desiredExits },
            portfolio, dayStartEquity!, dailyTurnoverUsd, policy) :
            planUniverseShadow(slot, decision.target, portfolio, policy);
          nextPortfolio = step.portfolio;
          if ('dailyTurnoverUsd' in step && typeof step.dailyTurnoverUsd === 'string')
            dailyTurnoverUsd = step.dailyTurnoverUsd;
          planning = step;
        } catch { planning = { status: 'blocked', reason: 'virtual_execution_evidence_unavailable' }; }
      }
      record('shadow', String(slotMs), { ...decision, policyHash, frameHash: frame.hash,
        studyKey: `${MARKET_SELECTOR_VERSION}:${policyHash}`, portfolio: nextPortfolio,
        pending, planning, dayStartEquity, dailyTurnoverUsd, immediateFillAssumption: true });
    } catch (error) {
      input.onUnexpectedError('market_selector_research', error);
      try { record('failure', String(input.clock.nowMs()),
        { reason: 'market_selector_shadow_failed', executionEnabled: false }); }
      catch { /* Original error already reported. */ }
    } finally { busy = false; }
  } };
}
