import {
  migrateConnectionSecretAlias,
  migrateLegacyConnectionSecret,
  parseCoinbaseKeyFileJson,
  parseRobinhoodCryptoCredentialsJson,
  parseStoredRobinhoodCryptoCredentials,
  parseStoredCoinbaseCredentials,
  removeConnectionSecret,
  serializeCoinbaseCredentials,
  serializeRobinhoodCryptoCredentials,
  validateCoinbaseCredentials,
  writeConnectionSecret,
  createRobinhoodCryptoReadClient,
  type RobinhoodCryptoReadClient,
  type SecretStore,
} from '@coqui/adapters';
import { profileConnectionV2, sha256Hex, type Clock, type PriceSource, type ProfileConnectionV2 } from '@coqui/core';
import {
  createCoinbaseViewOnlyVerifier,
  createDefaultCoinbaseEvidenceAcquirer,
  persistCoinbasePortfolioSnapshotV2,
  persistRobinhoodPortfolioSnapshotV2,
  type CoinbaseEvidenceAcquirer,
  type CoinbaseCredentialVerifier,
} from '@coqui/services';
import {
  getLatestConnectionAccountSnapshotV2,
  getLatestUnifiedPortfolioSnapshotV2,
  getLegacyProfileConnectionId,
  getProfileConnectionV2,
  linkProfileConnectionMigration,
  listPortfolioValuationObservations,
  listProfileConnections,
  listProfileConnectionsV2,
  listProviderAccountRefs,
  saveProfileConnectionV2,
  type Db,
} from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

export interface ConnectionFileSelection {
  readonly contents: string;
}

function secretRef(connection: ProfileConnectionV2) {
  return { profileId: connection.profileId, connectionId: connection.id,
    provider: connection.provider, credentialType: 'api_credentials' as const, schemaVersion: 2 as const };
}

function view(connection: ProfileConnectionV2, database: Db) {
  const snapshot = getLatestConnectionAccountSnapshotV2(connection.profileId, connection.id, database);
  return Object.freeze({
    id: connection.id, profileId: connection.profileId, provider: connection.provider,
    label: connection.label, credentialFingerprint: connection.credentialFingerprint,
    capabilities: connection.capabilities, status: connection.status,
    createdAtMs: connection.createdAtMs, updatedAtMs: connection.updatedAtMs,
    accountSuffixes: listProviderAccountRefs(connection.profileId, connection.id, database)
      .map((account) => account.maskedDisplaySuffix),
    lastSuccessfulSyncAtMs: snapshot?.health === 'healthy' ? snapshot.asOfMs : null,
    permissions: snapshot?.permissions ?? null, health: snapshot?.health ?? 'unknown' as const,
    valuationComplete: snapshot?.complete ?? false, failureReason: snapshot?.failureReason ?? null,
    readOnly: true as const, liveExecutionAuthority: false as const,
  });
}

export function createConnectionHandlers(input: {
  readonly profileId: string;
  readonly database: Db;
  readonly clock: Clock;
  readonly priceSource: PriceSource;
  readonly secrets?: SecretStore;
  readonly pickConnectionFile?: (provider: 'coinbase' | 'robinhood_crypto') => Promise<ConnectionFileSelection | null>;
  readonly coinbaseAcquirer?: CoinbaseEvidenceAcquirer;
  readonly coinbaseVerifier?: CoinbaseCredentialVerifier;
  readonly robinhoodClientFactory?: (credentials: Parameters<typeof createRobinhoodCryptoReadClient>[0]) => RobinhoodCryptoReadClient;
}): ChannelHandlers {
  const outcomes = new Map<string, Awaited<ReturnType<NonNullable<ChannelHandlers[keyof ChannelHandlers]>>>>();
  const acquirer = input.coinbaseAcquirer ?? createDefaultCoinbaseEvidenceAcquirer();
  const robinhoodClientFactory = input.robinhoodClientFactory ?? ((credentials) => createRobinhoodCryptoReadClient(credentials));

  async function ensureLegacyCoinbase(): Promise<void> {
    for (const legacy of listProfileConnections(input.profileId, input.database)) {
      const candidate = profileConnectionV2(input.profileId, 'coinbase', legacy.externalIdentityHash,
        legacy.createdAtMs, legacy.label);
      const connection = getProfileConnectionV2(input.profileId, candidate.id, input.database) ?? {
        ...candidate, capabilities: legacy.capabilities, status: legacy.status,
        updatedAtMs: legacy.updatedAtMs,
      };
      saveProfileConnectionV2(connection, input.database);
      linkProfileConnectionMigration(legacy.id, connection.id, input.clock.nowMs(), input.database);
    }
    if (input.secrets === undefined) return;
    const legacy = await input.secrets.read('coinbase-credentials', input.profileId);
    if (!legacy.ok || legacy.value === null) return;
    const credentials = parseStoredCoinbaseCredentials(legacy.value);
    if (credentials === null || !validateCoinbaseCredentials(credentials).ok) return;
    const candidate = profileConnectionV2(input.profileId, 'coinbase', sha256Hex(credentials.keyName), input.clock.nowMs());
    if (getProfileConnectionV2(input.profileId, candidate.id, input.database) === null) {
      saveProfileConnectionV2(candidate, input.database);
    }
  }

  async function sync(connection: ProfileConnectionV2) {
    if (input.secrets === undefined) return { ok: false as const, issues: [{ path: [], code: 'secret_store_unavailable' }] };
    const legacyConnectionId = getLegacyProfileConnectionId(input.profileId, connection.id, input.database);
    let stored = legacyConnectionId === null ? { ok: true as const, value: null }
      : await migrateConnectionSecretAlias(input.secrets, {
        profileId: input.profileId, connectionId: legacyConnectionId,
        provider: 'coinbase', credentialType: 'api_credentials',
      }, secretRef(connection));
    if (stored.ok && stored.value === null) {
      stored = await migrateLegacyConnectionSecret(input.secrets, secretRef(connection));
    }
    if (!stored.ok || stored.value === null) return { ok: false as const, issues: [{ path: [], code: 'credentials_unavailable' }] };
    if (connection.provider === 'robinhood_crypto') {
      const credentials = parseStoredRobinhoodCryptoCredentials(stored.value);
      if (credentials === null) return { ok: false as const, issues: [{ path: [], code: 'credentials_invalid' }] };
      const requestedAtMs = input.clock.nowMs(), client = robinhoodClientFactory(credentials);
      try {
        const acquired = await client.acquire();
        if (!acquired.ok) return { ok: false as const, issues: [{ path: [], code: `robinhood_${acquired.code}` }] };
        await persistRobinhoodPortfolioSnapshotV2({ profileId: input.profileId,
          credentialFingerprint: connection.credentialFingerprint, requestedAtMs,
          receivedAtMs: input.clock.nowMs(), evidence: acquired.value }, input.database, input.priceSource);
        return { ok: true as const, value: view(getProfileConnectionV2(input.profileId, connection.id, input.database)!, input.database) };
      } finally { client.destroy(); }
    }
    const credentials = parseStoredCoinbaseCredentials(stored.value);
    if (credentials === null || !validateCoinbaseCredentials(credentials).ok) {
      return { ok: false as const, issues: [{ path: [], code: 'credentials_invalid' }] };
    }
    const requestedAtMs = input.clock.nowMs();
    const acquired = await acquirer.acquire(credentials);
    if (!acquired.ok) return { ok: false as const, issues: [{ path: [], code: `coinbase_${acquired.code}` }] };
    const receivedAtMs = input.clock.nowMs();
    await persistCoinbasePortfolioSnapshotV2({
      profileId: input.profileId, credentialFingerprint: connection.credentialFingerprint,
      requestedAtMs, receivedAtMs, accounts: acquired.value.accounts,
      feeTier: acquired.value.feeTier ?? null,
    }, input.database, input.priceSource);
    return { ok: true as const, value: view(getProfileConnectionV2(input.profileId, connection.id, input.database)!, input.database) };
  }

  async function once(commandId: string, execute: () => Promise<{ ok: boolean; value?: unknown; issues?: readonly { path: readonly string[]; code: string }[] }>) {
    const prior = outcomes.get(commandId);
    if (prior !== undefined) return prior;
    const result = await execute();
    outcomes.set(commandId, result as never);
    return result;
  }

  return {
    'connections.list': async () => {
      await ensureLegacyCoinbase();
      return { ok: true, value: { asOfMs: input.clock.nowMs(),
        connections: listProfileConnectionsV2(input.profileId, input.database).map((item) => view(item, input.database)) } };
    },
    'connections.status': (payload: { readonly connectionId: string }) => {
      const connection = getProfileConnectionV2(input.profileId, payload.connectionId, input.database);
      return connection === null ? { ok: false, issues: [{ path: ['connectionId'], code: 'connection_not_found' }] }
        : { ok: true, value: view(connection, input.database) };
    },
    'connections.connect-file': async (payload: { readonly commandId: string; readonly provider: 'coinbase' | 'robinhood_crypto'; readonly label?: string }) => once(payload.commandId, async () => {
      if (input.secrets === undefined || input.pickConnectionFile === undefined) return { ok: false, issues: [{ path: [], code: 'connection_file_unavailable' }] };
      const selected = await input.pickConnectionFile(payload.provider);
      if (selected === null) return { ok: false, issues: [{ path: [], code: 'cancelled' }] };
      if (payload.provider === 'robinhood_crypto') {
        const parsed = parseRobinhoodCryptoCredentialsJson(selected.contents);
        if (!parsed.ok) return { ok: false, issues: [{ path: [], code: `robinhood_${parsed.code}` }] };
        const atMs = input.clock.nowMs();
        const connection = profileConnectionV2(input.profileId, payload.provider, sha256Hex(parsed.credentials.apiKey), atMs, payload.label);
        const written = await writeConnectionSecret(input.secrets, secretRef(connection), serializeRobinhoodCryptoCredentials(parsed.credentials));
        if (!written.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
        try { saveProfileConnectionV2(connection, input.database); } catch {
          await removeConnectionSecret(input.secrets, secretRef(connection));
          return { ok: false, issues: [{ path: [], code: 'connection_storage_rejected' }] };
        }
        const synced = await sync(connection);
        if (synced.ok) return synced;
        await removeConnectionSecret(input.secrets, secretRef(connection));
        saveProfileConnectionV2({ ...connection, status: 'attention_required', updatedAtMs: input.clock.nowMs() }, input.database);
        return synced;
      }
      const parsed = parseCoinbaseKeyFileJson(selected.contents);
      if (!parsed.ok) return { ok: false, issues: [{ path: [], code: 'invalid_coinbase_key_file' }] };
      const verified = await (input.coinbaseVerifier ?? createCoinbaseViewOnlyVerifier()).verify(parsed.credentials);
      if (!verified.ok) return { ok: false, issues: [{ path: [], code: `coinbase_${verified.reasonCode}` }] };
      const atMs = input.clock.nowMs();
      const connection = profileConnectionV2(input.profileId, 'coinbase', sha256Hex(parsed.credentials.keyName), atMs, payload.label);
      const written = await writeConnectionSecret(input.secrets, secretRef(connection), serializeCoinbaseCredentials(parsed.credentials));
      if (!written.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      try { saveProfileConnectionV2(connection, input.database); } catch {
        await removeConnectionSecret(input.secrets, secretRef(connection));
        return { ok: false, issues: [{ path: [], code: 'connection_storage_rejected' }] };
      }
      const synced = await sync(connection);
      return synced.ok ? synced : { ok: true, value: view(connection, input.database) };
    }),
    'connections.rename': async (payload: { readonly commandId: string; readonly connectionId: string; readonly label: string }) => once(payload.commandId, async () => {
      const connection = getProfileConnectionV2(input.profileId, payload.connectionId, input.database);
      if (connection === null) return { ok: false, issues: [{ path: ['connectionId'], code: 'connection_not_found' }] };
      const updated = { ...connection, label: payload.label, updatedAtMs: input.clock.nowMs() };
      saveProfileConnectionV2(updated, input.database);
      return { ok: true, value: view(updated, input.database) };
    }),
    'connections.disconnect': async (payload: { readonly commandId: string; readonly connectionId: string }) => once(payload.commandId, async () => {
      const connection = getProfileConnectionV2(input.profileId, payload.connectionId, input.database);
      if (connection === null) return { ok: false, issues: [{ path: ['connectionId'], code: 'connection_not_found' }] };
      if (input.secrets === undefined) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      const removed = await removeConnectionSecret(input.secrets, secretRef(connection));
      if (!removed.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      const updated = { ...connection, status: 'disconnected' as const, updatedAtMs: input.clock.nowMs() };
      saveProfileConnectionV2(updated, input.database);
      return { ok: true, value: view(updated, input.database) };
    }),
    'connections.sync': async (payload: { readonly commandId: string; readonly connectionId: string }) => once(payload.commandId, async () => {
      const connection = getProfileConnectionV2(input.profileId, payload.connectionId, input.database);
      return connection === null ? { ok: false, issues: [{ path: ['connectionId'], code: 'connection_not_found' }] } : sync(connection);
    }),
    'portfolio.current': () => {
      const snapshot = getLatestUnifiedPortfolioSnapshotV2(input.profileId, false, input.database);
      return { ok: true, value: snapshot === null ? null : {
        snapshotId: snapshot.id, profileId: snapshot.profileId, asOfMs: snapshot.asOfMs,
        connectionSnapshotIds: snapshot.connectionSnapshotIds, exposures: snapshot.exposures,
        totalValueUsd: snapshot.totalValueUsd, complete: snapshot.complete, source: 'connected_accounts' as const,
      } };
    },
    'portfolio.history': (payload: { readonly limit: number }) => ({ ok: true, value: {
      observations: listPortfolioValuationObservations(input.profileId, input.database).slice(-payload.limit),
    } }),
  } as ChannelHandlers;
}
