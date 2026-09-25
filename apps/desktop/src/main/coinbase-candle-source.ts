import {
  createCoinbaseReadHttpClient,
  fetchAuthenticatedCoinbaseDailyBars,
  fetchAuthenticatedCoinbaseDisplayBars,
  fetchCoinbaseDailyBars,
  fetchCoinbaseDisplayBars,
  migrateConnectionSecretAlias,
  migrateLegacyConnectionSecret,
  parseStoredCoinbaseCredentials,
  readConnectionSecret,
  validateCoinbaseCredentials,
  type CoinbaseCredentials,
  type CoinbaseReadHttpClient,
  type HttpClient,
  type RateLimiterRegistry,
  type SecretStore,
} from '@coqui/adapters';
import type { InstrumentIdentity } from '@coqui/core';
import { getLegacyProfileConnectionId, listProfileConnectionsV2, type Db } from '@coqui/storage';

type Interval = Parameters<typeof fetchCoinbaseDisplayBars>[2]['interval'];

export function createHistoricalCoinbaseCandleSource(input: {
  readonly database: Db;
  readonly profileId: string;
  readonly publicHttp: HttpClient;
  readonly rateLimiters: RateLimiterRegistry;
  readonly nowMs: () => number;
  readonly secrets?: SecretStore;
  readonly clientFactory?: (credentials: CoinbaseCredentials) => CoinbaseReadHttpClient;
  readonly onSource?: (source: 'authenticated' | 'public', productId: string, interval: string) => void;
}) {
  async function authenticatedClient() {
    if (input.secrets === undefined) return null;
    const connection = listProfileConnectionsV2(input.profileId, input.database)
      .filter((item) => item.provider === 'coinbase' && item.status === 'active')
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id))[0];
    if (connection === undefined) return null;
    const ref = { profileId: input.profileId, connectionId: connection.id,
      provider: 'coinbase' as const, credentialType: 'api_credentials' as const, schemaVersion: 2 as const };
    try {
      const legacyId = getLegacyProfileConnectionId(input.profileId, connection.id, input.database);
      let stored = legacyId === null ? await readConnectionSecret(input.secrets, ref)
        : await migrateConnectionSecretAlias(input.secrets, {
          profileId: input.profileId, connectionId: legacyId, provider: 'coinbase',
          credentialType: 'api_credentials',
        }, ref);
      if (stored.ok && stored.value === null) stored = await migrateLegacyConnectionSecret(input.secrets, ref);
      if (!stored.ok || stored.value === null) return null;
      const credentials = parseStoredCoinbaseCredentials(stored.value);
      if (credentials === null || !validateCoinbaseCredentials(credentials).ok) return null;
      return input.clientFactory?.(credentials) ?? createCoinbaseReadHttpClient(credentials,
        { rateLimiters: input.rateLimiters });
    } catch {
      return null;
    }
  }

  const source = {
    async dailyBars(instrument: InstrumentIdentity, lookbackDays: number, nowMs: number) {
      const client = await authenticatedClient();
      if (client !== null) {
        try {
          const result = await fetchAuthenticatedCoinbaseDailyBars(client, instrument,
            { maxDays: lookbackDays, nowMs });
          if (result.ok && result.data.length > 0) {
            input.onSource?.('authenticated', instrument.productId, '1d');
            return { ok: true as const, bars: result.data };
          }
        } catch { /* A complete public request is the fallback. */ }
        finally { client.destroy(); }
      }
      const result = await fetchCoinbaseDailyBars(input.publicHttp, instrument, { maxDays: lookbackDays, nowMs });
      if (result.ok) input.onSource?.('public', instrument.productId, '1d');
      return result.ok ? { ok: true as const, bars: result.data } : { ok: false as const };
    },
    async displayBars(instrument: InstrumentIdentity, interval: Interval,
      startTimeMs: number, endTimeMs: number, nowMs: number) {
      const client = await authenticatedClient();
      if (client !== null) {
        try {
          const result = await fetchAuthenticatedCoinbaseDisplayBars(client, instrument,
            { interval, startTimeMs, endTimeMs, nowMs });
          if (result.ok) {
            input.onSource?.('authenticated', instrument.productId, interval);
            return { ok: true as const, bars: result.data };
          }
        } catch { /* A complete public request is the fallback. */ }
        finally { client.destroy(); }
      }
      const result = await fetchCoinbaseDisplayBars(input.publicHttp, instrument,
        { interval, startTimeMs, endTimeMs, nowMs });
      if (result.ok) input.onSource?.('public', instrument.productId, interval);
      return result.ok ? { ok: true as const, bars: result.data } : { ok: false as const };
    },
  };
  return { ...source, authenticatedClient,
    async recentCandles(instrument: InstrumentIdentity, timeframe: string) {
      const intervalMs: Record<string, number> = { '1m': 60_000, '5m': 300_000,
        '15m': 900_000, '1h': 3_600_000, '6h': 21_600_000, '1d': 86_400_000 };
      const ms = intervalMs[timeframe];
      if (ms === undefined) return [];
      const nowMs = input.nowMs();
      const endMs = Math.ceil(nowMs / ms) * ms;
      const result = await source.displayBars(instrument, timeframe as Interval,
        endMs - 300 * ms, endMs, nowMs);
      return result.ok ? result.bars.map((bar) => ({ time: bar.startTimeMs,
        open: Number(bar.open), high: Number(bar.high), low: Number(bar.low),
        close: Number(bar.close), volume: Number(bar.volume ?? '0') })) : [];
    },
  };
}
