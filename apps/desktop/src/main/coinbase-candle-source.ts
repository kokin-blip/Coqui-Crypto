import {
  createCoinbaseReadHttpClient,
  deadlineHttp,
  deadlineReadHttp,
  withinDeadline,
  createResearchDeadline,
  type RequestDeadline,
  fetchAuthenticatedCoinbaseDailyBars,
  fetchAuthenticatedCoinbaseDisplayBars,
  fetchCoinbaseDailyBars,
  fetchCoinbaseDisplayBars,
  parseStoredCoinbaseCredentials,
  readConnectionSecret,
  validateCoinbaseCredentials,
  type CoinbaseCredentials,
  type CoinbaseDisplayBar,
  type CoinbaseReadHttpClient,
  type HttpClient,
  type HttpFailure,
  type RateLimiterRegistry,
  type SecretStore,
} from '@coqui/adapters';
import { sha256Hex, type InstrumentIdentity } from '@coqui/core';
import { connectionEligible, getProfileConnectionV2, getLegacyProfileConnectionId, listProfileConnectionsV2, type Db } from '@coqui/storage';

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
  readonly onFailure?: (source: 'authenticated' | 'public', productId: string,
    interval: string, status: number, reason: HttpFailure['reason'] | 'empty' | 'exception') => void;
}) {
  async function authenticatedClient() {
    if (input.secrets === undefined) return null;
    const connection = listProfileConnectionsV2(input.profileId, input.database)
      .filter((item) => item.provider === 'coinbase' && item.status === 'active' && connectionEligible(item,input.database))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id))[0];
    if (connection === undefined) return null;
    const ref = { profileId: input.profileId, connectionId: connection.id,
      provider: 'coinbase' as const, credentialType: 'api_credentials' as const, schemaVersion: 2 as const };
    try {
      const legacyId = getLegacyProfileConnectionId(input.profileId, connection.id, input.database);
      // Chart reads must not migrate aliases while a lifecycle cleanup is awaiting the OS.
      let stored = await readConnectionSecret(input.secrets, ref);
      if (stored.ok && stored.value === null && legacyId !== null) stored = await readConnectionSecret(input.secrets, {
        profileId: input.profileId, connectionId: legacyId, provider: 'coinbase', credentialType: 'api_credentials',
      });
      if (stored.ok && stored.value === null) stored = await input.secrets.read('coinbase-credentials', input.profileId);
      if (!stored.ok || stored.value === null) return null;
      const credentials = parseStoredCoinbaseCredentials(stored.value);
      const current = getProfileConnectionV2(input.profileId, connection.id, input.database);
      if (credentials === null || !validateCoinbaseCredentials(credentials).ok ||
          sha256Hex(credentials.keyName) !== connection.credentialFingerprint ||
          current === null || !connectionEligible(current,input.database)) return null;
      return input.clientFactory?.(credentials) ?? createCoinbaseReadHttpClient(credentials,
        { rateLimiters: input.rateLimiters });
    } catch {
      return null;
    }
  }

  const source = {
    async dailyBars(instrument: InstrumentIdentity, lookbackDays: number, nowMs: number, deadline?: RequestDeadline) {
      const client = await withinDeadline(authenticatedClient(), deadline);
      if (client !== null) {
        try {
          const result = await fetchAuthenticatedCoinbaseDailyBars(deadline ? deadlineReadHttp(client, deadline) : client, instrument,
            { maxDays: lookbackDays, nowMs });
          if (result.ok && result.data.length > 0) {
            input.onSource?.('authenticated', instrument.productId, '1d');
            return { ok: true as const, bars: result.data };
          }
          input.onFailure?.('authenticated', instrument.productId, '1d', result.status,
            result.ok ? 'empty' : result.reason);
        } catch { input.onFailure?.('authenticated', instrument.productId, '1d', 0, 'exception'); }
        finally { client.destroy(); }
      }
      deadline?.check();
      const result = await fetchCoinbaseDailyBars(deadline ? deadlineHttp(input.publicHttp, deadline) : input.publicHttp, instrument, { maxDays: lookbackDays, nowMs });
      if (result.ok) input.onSource?.('public', instrument.productId, '1d');
      else input.onFailure?.('public', instrument.productId, '1d', result.status, result.reason);
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
          input.onFailure?.('authenticated', instrument.productId, interval, result.status, result.reason);
        } catch { input.onFailure?.('authenticated', instrument.productId, interval, 0, 'exception'); }
        finally { client.destroy(); }
      }
      const result = await fetchCoinbaseDisplayBars(input.publicHttp, instrument,
        { interval, startTimeMs, endTimeMs, nowMs });
      if (result.ok) input.onSource?.('public', instrument.productId, interval);
      else input.onFailure?.('public', instrument.productId, interval, result.status, result.reason);
      return result.ok ? { ok: true as const, bars: result.data } : { ok: false as const };
    },
  };
  return { ...source, authenticatedClient,
    async researchHourlyWindow(instrument: InstrumentIdentity, startTimeMs: number, endTimeMs: number,
      nowMs: number, researchDeadline?: RequestDeadline): Promise<{ readonly ok: true; readonly bars: readonly CoinbaseDisplayBar[];
        readonly source: 'authenticated' | 'public' } | { readonly ok: false }> {
      const deadline = researchDeadline ?? createResearchDeadline(input.nowMs);
      try {
      // Both endpoints can serve 300 hours. Complete each window from exactly one source.
      if (endTimeMs <= startTimeMs || endTimeMs - startTimeMs > 300 * 3_600_000) return { ok: false };
      const options = { interval: '1h' as const, startTimeMs, endTimeMs, nowMs };
      const complete = (bars: readonly CoinbaseDisplayBar[]) => {
        const starts = new Set(bars.filter((bar) => bar.isComplete && bar.endTimeMs <= nowMs).map((bar) => bar.startTimeMs));
        for (let at = startTimeMs; at < endTimeMs; at += 3_600_000) if (!starts.has(at)) return false;
        return true;
      };
      const client = await withinDeadline(authenticatedClient(), deadline);
      if (client !== null) {
        try {
          const result = await fetchAuthenticatedCoinbaseDisplayBars(deadlineReadHttp(client, deadline, 'research'), instrument, options);
          if (result.ok && complete(result.data)) {
            input.onSource?.('authenticated', instrument.productId, '1h');
            return { ok: true, bars: result.data, source: 'authenticated' };
          }
          input.onFailure?.('authenticated', instrument.productId, '1h', result.status,
            result.ok ? 'empty' : result.reason);
        } catch { input.onFailure?.('authenticated', instrument.productId, '1h', 0, 'exception'); }
        finally { client.destroy(); }
      }
      const result = await fetchCoinbaseDisplayBars(deadlineHttp(input.publicHttp, deadline, 'research'), instrument, options);
      if (result.ok && complete(result.data)) {
        input.onSource?.('public', instrument.productId, '1h');
        return { ok: true, bars: result.data, source: 'public' };
      }
      input.onFailure?.('public', instrument.productId, '1h', result.status,
        result.ok ? 'empty' : result.reason);
      return { ok: false };
      } finally { if (!researchDeadline) deadline.dispose(); }
    },
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
