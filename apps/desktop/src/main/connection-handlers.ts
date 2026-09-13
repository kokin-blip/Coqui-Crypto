import { generateKeyPairSync, randomUUID } from 'node:crypto';

import {
  migrateConnectionSecretAlias,
  migrateLegacyConnectionSecret,
  parseCoinbaseKeyFileJson,
  parseRobinhoodCryptoCredentialsJson,
  parseStoredRobinhoodCryptoCredentials,
  parseStoredCoinbaseCredentials,
  readConnectionSecret,
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
  getRobinhoodConnectionSetup,
  getLatestPendingRobinhoodConnectionSetup,
  listExpiredRobinhoodConnectionSetups,
  saveRobinhoodConnectionSetup,
  saveProfileConnectionV2,
  updateRobinhoodConnectionSetupStatus,
  type Db,
} from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

export interface ConnectionFileSelection {
  readonly contents: string;
}

const ROBINHOOD_SETUP_TTL_MS = 30 * 60 * 1_000;
function pendingRobinhoodScope(profileId: string, setupId: string): string {
  return `pending.${profileId}.${setupId}`;
}

function createRobinhoodKeyPair(): { readonly publicKeyBase64: string; readonly privateKeyBase64: string } {
  const pair = generateKeyPairSync('ed25519');
  const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' });
  const privateDer = pair.privateKey.export({ format: 'der', type: 'pkcs8' });
  return Object.freeze({ publicKeyBase64: publicDer.subarray(publicDer.length - 32).toString('base64'),
    privateKeyBase64: privateDer.subarray(privateDer.length - 32).toString('base64') });
}

function pendingRobinhoodView(setup: { readonly id: string; readonly publicKeyBase64: string;
  readonly expiresAtMs: number }) {
  return Object.freeze({ setupId: setup.id, publicKeyBase64: setup.publicKeyBase64,
    expiresAtMs: setup.expiresAtMs, privateKeyLocation: 'os_keychain' as const });
}

function secretRef(connection: ProfileConnectionV2) {
  return { profileId: connection.profileId, connectionId: connection.id,
    provider: connection.provider, credentialType: 'api_credentials' as const, schemaVersion: 2 as const };
}

function view(connection: ProfileConnectionV2, database: Db) {
  const snapshot = getLatestConnectionAccountSnapshotV2(connection.profileId, connection.id, database);
  const unified = getLatestUnifiedPortfolioSnapshotV2(connection.profileId, false, database);
  const health = snapshot?.health ?? 'unknown' as const;
  const connectionAvailable = connection.status !== 'disconnected';
  const lifecycle = Object.freeze({ schemaVersion: 2 as const,
    credentialVerification: connection.status === 'active' ? 'verified' as const : connection.status === 'disconnected' ? 'unavailable' as const : 'failed' as const,
    synchronization: snapshot === null ? 'never' as const : snapshot.health === 'unavailable' ? 'failed' as const : 'succeeded' as const,
    health,
    valuation: snapshot === null ? 'unavailable' as const : snapshot.complete ? 'complete' as const : 'incomplete' as const,
    portfolioReadiness: connectionAvailable && snapshot?.complete === true && unified?.complete === true
      ? 'ready' as const : 'blocked' as const,
    reasonCode: !connectionAvailable ? 'connection_disconnected' : snapshot?.failureReason ??
      (snapshot === null ? 'sync_required' : snapshot.complete ? null : 'valuation_incomplete'),
  });
  return Object.freeze({
    id: connection.id, profileId: connection.profileId, provider: connection.provider,
    label: connection.label, credentialFingerprint: connection.credentialFingerprint,
    capabilities: connection.capabilities, status: connection.status,
    createdAtMs: connection.createdAtMs, updatedAtMs: connection.updatedAtMs,
    accountSuffixes: listProviderAccountRefs(connection.profileId, connection.id, database)
      .map((account) => account.maskedDisplaySuffix),
    lastSuccessfulSyncAtMs: snapshot?.health === 'healthy' ? snapshot.asOfMs : null,
    permissions: snapshot?.permissions ?? null, health,
    valuationComplete: snapshot?.complete ?? false, failureReason: snapshot?.failureReason ?? null,
    lifecycle,
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
  readonly readClipboardText?: () => string;
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

  async function expireRobinhoodSetups(): Promise<void> {
    if (input.secrets === undefined) return;
    const now = input.clock.nowMs();
    for (const setup of listExpiredRobinhoodConnectionSetups(input.profileId, now, input.database)) {
      const removed = await input.secrets.remove('robinhood-pending-private-key', pendingRobinhoodScope(input.profileId, setup.id));
      if (removed.ok) updateRobinhoodConnectionSetupStatus(input.profileId, setup.id, 'pending', 'expired', now, input.database);
    }
  }

  async function pendingRobinhoodStatus() {
    await expireRobinhoodSetups();
    const setup = getLatestPendingRobinhoodConnectionSetup(input.profileId, input.clock.nowMs(), input.database);
    if (setup === null) return { state: 'none' as const, setup: null, reasonCode: null };
    const view = pendingRobinhoodView(setup);
    if (input.secrets === undefined) return { state: 'unavailable' as const, setup: view,
      reasonCode: 'secret_store_unavailable' as const };
    const pending = await input.secrets.read('robinhood-pending-private-key',
      pendingRobinhoodScope(input.profileId, setup.id));
    if (!pending.ok) return { state: 'unavailable' as const, setup: view,
      reasonCode: 'secret_store_unavailable' as const };
    if (pending.value === null) return { state: 'unavailable' as const, setup: view,
      reasonCode: 'pending_key_unavailable' as const };
    return { state: 'pending' as const, setup: view, reasonCode: null };
  }

  return {
    'connections.list': async () => {
      await expireRobinhoodSetups();
      await ensureLegacyCoinbase();
      return { ok: true, value: { asOfMs: input.clock.nowMs(),
        connections: listProfileConnectionsV2(input.profileId, input.database).map((item) => view(item, input.database)) } };
    },
    'connections.status': (payload: { readonly connectionId: string }) => {
      const connection = getProfileConnectionV2(input.profileId, payload.connectionId, input.database);
      return connection === null ? { ok: false, issues: [{ path: ['connectionId'], code: 'connection_not_found' }] }
        : { ok: true, value: view(connection, input.database) };
    },
    'connections.robinhood.keypair.status': async () => ({ ok: true, value: await pendingRobinhoodStatus() }),
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
      /* The credential is stored, but a failed first sync means no portfolio
         snapshot exists: reporting ok here would show “Credentials verified ·
         Coqui synchronized the account” while holdings never appear. The
         connection row stays for resume; the surface must show the truth. */
      return synced;
    }),
    'connections.robinhood.keypair.begin': async (payload: { readonly commandId: string }) => once(payload.commandId, async () => {
      if (input.secrets === undefined) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      const existing = await pendingRobinhoodStatus();
      if (existing.state === 'pending' && existing.setup !== null) return { ok: true, value: existing.setup };
      if (existing.state === 'unavailable' && existing.reasonCode === 'secret_store_unavailable') {
        return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      }
      const setupId = randomUUID(), now = input.clock.nowMs(), pair = createRobinhoodKeyPair();
      const written = await input.secrets.write('robinhood-pending-private-key', pair.privateKeyBase64,
        pendingRobinhoodScope(input.profileId, setupId));
      if (!written.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      try {
        saveRobinhoodConnectionSetup({ id: setupId, profileId: input.profileId, publicKeyBase64: pair.publicKeyBase64,
          status: 'pending', createdAtMs: now, expiresAtMs: now + ROBINHOOD_SETUP_TTL_MS, completedAtMs: null }, input.database);
      } catch {
        await input.secrets.remove('robinhood-pending-private-key', pendingRobinhoodScope(input.profileId, setupId));
        return { ok: false, issues: [{ path: [], code: 'connection_setup_storage_rejected' }] };
      }
      return { ok: true, value: pendingRobinhoodView({ id: setupId,
        publicKeyBase64: pair.publicKeyBase64, expiresAtMs: now + ROBINHOOD_SETUP_TTL_MS }) };
    }),
    'connections.robinhood.keypair.complete': async (payload: { readonly commandId: string; readonly setupId: string; readonly label?: string }) => once(payload.commandId, async () => {
      if (input.secrets === undefined || input.readClipboardText === undefined) return { ok: false, issues: [{ path: [], code: 'clipboard_or_secret_store_unavailable' }] };
      await expireRobinhoodSetups();
      const setup = getRobinhoodConnectionSetup(input.profileId, payload.setupId, input.database);
      if (setup === null || setup.status !== 'pending' || setup.expiresAtMs <= input.clock.nowMs()) {
        return { ok: false, issues: [{ path: ['setupId'], code: 'robinhood_setup_unavailable' }] };
      }
      const pending = await input.secrets.read('robinhood-pending-private-key', pendingRobinhoodScope(input.profileId, setup.id));
      if (!pending.ok || pending.value === null) return { ok: false, issues: [{ path: [], code: 'robinhood_pending_key_unavailable' }] };
      const parsed = parseRobinhoodCryptoCredentialsJson(JSON.stringify({ apiKey: input.readClipboardText().trim(), privateKeyBase64: pending.value }));
      if (!parsed.ok) return { ok: false, issues: [{ path: [], code: `robinhood_${parsed.code}` }] };
      const now = input.clock.nowMs(), connection = profileConnectionV2(input.profileId, 'robinhood_crypto',
        sha256Hex(parsed.credentials.apiKey), now, payload.label);
      const permanent = await writeConnectionSecret(input.secrets, secretRef(connection), serializeRobinhoodCryptoCredentials(parsed.credentials));
      if (!permanent.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      const verified = await readConnectionSecret(input.secrets, secretRef(connection));
      if (!verified.ok || verified.value !== serializeRobinhoodCryptoCredentials(parsed.credentials)) {
        await removeConnectionSecret(input.secrets, secretRef(connection));
        return { ok: false, issues: [{ path: [], code: 'secret_verification_failed' }] };
      }
      saveProfileConnectionV2(connection, input.database);
      const synced = await sync(connection);
      if (!synced.ok) {
        await removeConnectionSecret(input.secrets, secretRef(connection));
        saveProfileConnectionV2({ ...connection, status: 'attention_required', updatedAtMs: input.clock.nowMs() }, input.database);
        return synced;
      }
      const removed = await input.secrets.remove('robinhood-pending-private-key', pendingRobinhoodScope(input.profileId, setup.id));
      if (!removed.ok) return { ok: false, issues: [{ path: [], code: 'pending_secret_cleanup_failed' }] };
      updateRobinhoodConnectionSetupStatus(input.profileId, setup.id, 'pending', 'completed', input.clock.nowMs(), input.database);
      return synced;
    }),
    'connections.robinhood.keypair.cancel': async (payload: { readonly commandId: string; readonly setupId: string }) => once(payload.commandId, async () => {
      if (input.secrets === undefined) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      const setup = getRobinhoodConnectionSetup(input.profileId, payload.setupId, input.database);
      if (setup === null || setup.status !== 'pending') return { ok: false, issues: [{ path: ['setupId'], code: 'robinhood_setup_unavailable' }] };
      const removed = await input.secrets.remove('robinhood-pending-private-key', pendingRobinhoodScope(input.profileId, setup.id));
      if (!removed.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      updateRobinhoodConnectionSetupStatus(input.profileId, setup.id, 'pending', 'cancelled', input.clock.nowMs(), input.database);
      return { ok: true, value: { outcome: 'cancelled' as const } };
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
