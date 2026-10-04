import { buildDecisionMarketDataset, sourceCompletionDelayMs, type Clock, type InstrumentKey } from '@coqui/core';
import { fetchObservedShadowOpen, type HttpClient } from '@coqui/adapters';
import { resolveKillSwitch, readOverlayShadowStatus, setOverlayShadowEnabled, tickOverlayShadow, type ShadowBinding } from '@coqui/services';
import { listIntegrityEvents, listMarketBars, type Db } from '@coqui/storage';
import type { ChannelHandlers } from './dispatch.js';
export function createOverlayShadowRuntime(input: { profileId: string; database: Db; clock: Clock; http: HttpClient }) {
  const status = () => readOverlayShadowStatus(input.profileId, input.clock.nowMs(), input.database);
  const handlers: ChannelHandlers = {
    'research.overlay-shadow.status': () => ({ ok: true, value: status() }),
    'research.overlay-shadow.set': (payload: { commandId: string; enabled: boolean }) => {
      setOverlayShadowEnabled(input.profileId, payload.enabled, payload.commandId, input.clock.nowMs(), input.database);
      return { ok: true, value: status() };
    },
  };
  const tick = async () => {
    if (!status().enabled) return;
    const binding = listIntegrityEvents(`overlay-shadow:${JSON.stringify(input.profileId)}`, 'shadow_binding', input.database).at(-1)?.body as unknown as ShadowBinding | undefined;
    if (!binding) return;
    // Capture current opens before reading local history; never request historical opens for missed actions.
    const open = await fetchObservedShadowOpen(input.http, binding.plan.universe.assets as InstrumentKey[], () => input.clock.nowMs());
    const atMs = input.clock.nowMs();
    const bars = Object.fromEntries(binding.plan.universe.assets.map((asset) => {
      const [venue, productType, productId] = asset.split('|');
      if (venue !== 'coinbase' || productType !== 'spot' || !productId) throw new Error('shadow_universe_unsupported');
      return [asset, listMarketBars({ venue, productType, productId }, input.database).filter((bar) => bar.interval === '1d' && bar.isComplete &&
        bar.endTimeMs + sourceCompletionDelayMs(bar.source) <= atMs).map((bar) => ({ assetId: asset as InstrumentKey,
        source: bar.source, interval: '1d' as const, startTimeMs: bar.startTimeMs, endTimeMs: bar.endTimeMs, open: Number(bar.open),
        high: Number(bar.high), low: Number(bar.low), close: Number(bar.close), volume: bar.volume === null ? null : Number(bar.volume),
        isComplete: true, retrievedAtMs: bar.retrievedAtMs, quality: bar.quality }))];
    }));
    const dataset = buildDecisionMarketDataset(bars, binding.plan.universe.assets as InstrumentKey[], { policy: 'reject-on-gap', nowMs: atMs });
    tickOverlayShadow({ safetyStopped: resolveKillSwitch(input.profileId, input.database).engaged, profile: input.profileId, atMs, dataset, open, db: input.database });
  };
  return { handlers, tick };
}
