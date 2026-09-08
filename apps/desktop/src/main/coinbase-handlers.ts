import type { SecretStore } from '@coqui/adapters';
import type { Clock, PriceSource } from '@coqui/core';
import {
  CoinbaseAccountSyncService,
  type CoinbaseEvidenceAcquirer,
} from '@coqui/services';
import { getSetting, type Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

/** Epoch of the last completed Coinbase sync, or null when absent or corrupt. */
export function lastCoinbaseSyncAtMs(database: Db): number | null {
  const raw = getSetting('coinbase.last_sync_at', database);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createCoinbaseSyncHandlers(input: {
  readonly profileId: string;
  readonly database: Db;
  readonly clock: Clock;
  readonly secrets?: SecretStore;
  readonly acquirer?: CoinbaseEvidenceAcquirer;
  readonly priceSource?: PriceSource;
}): ChannelHandlers {
  const service = input.secrets === undefined
    ? null
    : new CoinbaseAccountSyncService({
        database: input.database,
        clock: input.clock,
        secretStore: input.secrets,
        ...(input.acquirer === undefined ? {} : { acquirer: input.acquirer }),
        ...(input.priceSource === undefined ? {} : { priceSource: input.priceSource }),
      });
  const outcomes = new Map<string, Awaited<ReturnType<CoinbaseAccountSyncService['sync']>>>();
  return {
    'accounts.coinbase.sync': async (payload: { readonly commandId: string }) => {
      if (service === null) {
        return { ok: false, issues: [{ path: [], code: 'credentials_unavailable' }] };
      }
      const prior = outcomes.get(payload.commandId);
      const result = prior ?? await service.sync(input.profileId);
      if (prior === undefined) outcomes.set(payload.commandId, result);
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, issues: [{ path: [], code: result.code }] };
    },
  } as ChannelHandlers;
}
