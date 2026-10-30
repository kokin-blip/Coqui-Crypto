import { createAlpacaPaperClient, withinDeadline, type HttpClient, type SecretStore } from '@coqui/adapters';
import type { Clock } from '@coqui/core';
import { HourlyShadowService, PARALLEL_INSTRUMENTS, resolveKillSwitch } from '@coqui/services';
import type { Db } from '@coqui/storage';
import { createPaperMarketFeed, type PaperMarketFeedDependencies } from './paper-market.js';

export function createHourlyShadowRuntime(input: {
  readonly profileId: string; readonly hostId: string; readonly hostKind: 'desktop' | 'headless';
  readonly database: Db; readonly clock: Clock; readonly http: HttpClient;
  readonly bars: PaperMarketFeedDependencies['bars']; readonly secrets?: SecretStore;
  readonly onUnexpectedError: (context: string, error: unknown) => void;
}) {
  const market = createPaperMarketFeed({ database: input.database, http: input.http, now: () => input.clock.nowMs(),
    instruments: () => PARALLEL_INSTRUMENTS, bars: input.bars, onUnexpectedError: input.onUnexpectedError });
  return new HourlyShadowService({ ...input, refresh: (nowMs, deadline) => market.refresh(nowMs, deadline),
    killSwitchEngaged: () => resolveKillSwitch(input.profileId, input.database).engaged,
    async readClient(deadline) {
      if (!input.secrets) throw new Error('secret_store_unavailable');
      const stored = await withinDeadline(input.secrets.read('alpaca-paper-credentials', input.profileId), deadline);
      if (!stored.ok || stored.value === null) throw new Error('credentials_unavailable');
      let value: unknown;
      try { value = JSON.parse(stored.value); } catch { throw new Error('credentials_unavailable'); }
      if (!value || typeof value !== 'object' || !('keyId' in value) || !('secretKey' in value) ||
          typeof value.keyId !== 'string' || typeof value.secretKey !== 'string') throw new Error('credentials_unavailable');
      const client = createAlpacaPaperClient({ keyId: value.keyId, secretKey: value.secretKey }, undefined, deadline);
      return Object.freeze({ account: client.account, positions: client.positions,
        asset: client.asset, latestCryptoQuotes: client.latestCryptoQuotes });
    } });
}
