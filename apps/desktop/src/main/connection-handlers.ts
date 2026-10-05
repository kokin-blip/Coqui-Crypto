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
  ConnectorRemovalService, connectorRemovalPreview, createProfileOperationGate,
  type ProfileOperationGate,
  createCoinbaseViewOnlyVerifier,
  createDefaultCoinbaseEvidenceAcquirer,
  persistCoinbasePortfolioSnapshotV2,
  persistRobinhoodPortfolioSnapshotV2,
  type CoinbaseEvidenceAcquirer,
  type CoinbaseCredentialVerifier,
} from '@coqui/services';
import {
  getLatestConnectionAccountSnapshotV2,
  getCurrentUnifiedPortfolioSnapshotV2, connectionEligible, connectionRemoval, setConnectionRemoval,
  listVerifiedWalletIdentities, saveVerifiedWalletIdentity, normalizeWalletNickname,
  type WalletNicknameStore, type ProfileManifestStore,
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
  const unified = getCurrentUnifiedPortfolioSnapshotV2(connection.profileId, database);
  const health = snapshot?.health ?? 'unknown' as const;
  const connectionAvailable = connectionEligible(connection,database);
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
    removalState: connectionRemoval(connection.profileId,connection.id,database)?.state??null,
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
  readonly operationGate?: ProfileOperationGate;
  readonly manifestStore?: ProfileManifestStore;
  readonly nicknameStore?: WalletNicknameStore;
  readonly pickConnectionFile?: (provider: 'coinbase' | 'robinhood_crypto') => Promise<ConnectionFileSelection | null>;
  readonly readClipboardText?: () => string;
  readonly coinbaseAcquirer?: CoinbaseEvidenceAcquirer;
  readonly coinbaseVerifier?: CoinbaseCredentialVerifier;
  readonly robinhoodClientFactory?: (credentials: Parameters<typeof createRobinhoodCryptoReadClient>[0]) => RobinhoodCryptoReadClient;
}): ChannelHandlers {
  const gate=input.operationGate??createProfileOperationGate();
  let commandBusy=false;
  const removal=new ConnectorRemovalService(input);
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
      if(connectionRemoval(input.profileId,connection.id,input.database)?.state!=='pending'&&connectionRemoval(input.profileId,connection.id,input.database)?.state!=='removed')saveProfileConnectionV2(connection, input.database);
      linkProfileConnectionMigration(legacy.id, connection.id, input.clock.nowMs(), input.database);
    }
    if (input.secrets === undefined) return;
    const legacy = await input.secrets.read('coinbase-credentials', input.profileId);
    if (!legacy.ok || legacy.value === null) return;
    const credentials = parseStoredCoinbaseCredentials(legacy.value);
    if (credentials === null || !validateCoinbaseCredentials(credentials).ok) return;
    const candidate = profileConnectionV2(input.profileId, 'coinbase', sha256Hex(credentials.keyName), input.clock.nowMs());
    if (connectionRemoval(input.profileId,candidate.id,input.database)===null&&getProfileConnectionV2(input.profileId, candidate.id, input.database) === null) {
      saveProfileConnectionV2(candidate, input.database);
    }
  }

  async function sync(connection: ProfileConnectionV2) {
    if(!connectionEligible(connection,input.database))return {ok:false as const,issues:[{path:[],code:'connection_disconnected'}]};
    if (input.secrets === undefined) return { ok: false as const, issues: [{ path: [], code: 'secret_store_unavailable' }] };
    const legacyConnectionId = getLegacyProfileConnectionId(input.profileId, connection.id, input.database);
    let stored = legacyConnectionId === null ? { ok: true as const, value: null }
      : await migrateConnectionSecretAlias(input.secrets, {
        profileId: input.profileId, connectionId: legacyConnectionId,
        provider: 'coinbase', credentialType: 'api_credentials',
      }, secretRef(connection));
    if (stored.ok && stored.value === null) {
      const key=connection.provider==='coinbase'?'coinbase-credentials':'robinhood-crypto-credentials';
      const legacy=await input.secrets.read(key,input.profileId);
      const credentials=legacy.ok&&legacy.value!==null ? connection.provider==='coinbase'
        ? parseStoredCoinbaseCredentials(legacy.value):parseStoredRobinhoodCryptoCredentials(legacy.value):null;
      const fingerprint=credentials===null?null:sha256Hex('keyName' in credentials?credentials.keyName:credentials.apiKey);
      if(fingerprint===connection.credentialFingerprint)stored = await migrateLegacyConnectionSecret(input.secrets, secretRef(connection));
      else stored=await readConnectionSecret(input.secrets,secretRef(connection));
    }
    if (!stored.ok || stored.value === null) return { ok: false as const, issues: [{ path: [], code: 'credentials_unavailable' }] };
    if (connection.provider === 'robinhood_crypto') {
      const credentials = parseStoredRobinhoodCryptoCredentials(stored.value);
      if (credentials === null) return { ok: false as const, issues: [{ path: [], code: 'credentials_invalid' }] };
      if(sha256Hex(credentials.apiKey)!==connection.credentialFingerprint)return {ok:false as const,issues:[{path:[],code:'credential_identity_mismatch'}]};
      const requestedAtMs = input.clock.nowMs(), client = robinhoodClientFactory(credentials);
      try {
        const acquired = await client.acquire();
        if (!acquired.ok) return { ok: false as const, issues: [{ path: [], code: `robinhood_${acquired.code}` }] };
        if(!connectionEligible(getProfileConnectionV2(input.profileId,connection.id,input.database)!,input.database))return {ok:false as const,issues:[{path:[],code:'connection_disconnected'}]};
        for(const account of acquired.value.accounts)saveVerifiedWalletIdentity(connection,'account',account.accountNumber,input.clock.nowMs(),input.database);
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
    if(sha256Hex(credentials.keyName)!==connection.credentialFingerprint)return {ok:false as const,issues:[{path:[],code:'credential_identity_mismatch'}]};
    if(!listVerifiedWalletIdentities(input.profileId,input.database).some(w=>w.connection_id===connection.id)){
      const verified=await (input.coinbaseVerifier??createCoinbaseViewOnlyVerifier()).verify(credentials);
      if(!verified.ok)return {ok:false as const,issues:[{path:[],code:'wallet_identity_unverified'}]};
      saveVerifiedWalletIdentity(connection,'portfolio',verified.portfolioUuid,input.clock.nowMs(),input.database);
    }
    const requestedAtMs = input.clock.nowMs();
    const acquired = await acquirer.acquire(credentials);
    if (!acquired.ok) return { ok: false as const, issues: [{ path: [], code: `coinbase_${acquired.code}` }] };
    if(!connectionEligible(getProfileConnectionV2(input.profileId,connection.id,input.database)!,input.database))return {ok:false as const,issues:[{path:[],code:'connection_disconnected'}]};
    const receivedAtMs = input.clock.nowMs();
    await persistCoinbasePortfolioSnapshotV2({
      profileId: input.profileId, credentialFingerprint: connection.credentialFingerprint,
      requestedAtMs, receivedAtMs, accounts: acquired.value.accounts,
      feeTier: acquired.value.feeTier ?? null,
    }, input.database, input.priceSource);
    return { ok: true as const, value: view(getProfileConnectionV2(input.profileId, connection.id, input.database)!, input.database) };
  }

  const inFlight=new Map<string,Promise<{ok:boolean;value?:unknown;issues?:readonly {path:readonly string[];code:string}[]}>>();
  async function once(commandId: string, execute: () => Promise<{ ok: boolean; value?: unknown; issues?: readonly { path: readonly string[]; code: string }[] }>) {
    const prior=outcomes.get(commandId);if(prior!==undefined)return prior;
    const pending=inFlight.get(commandId);if(pending)return pending;
    if(!gate.begin())return {ok:false,issues:[{path:[],code:'connection_operation_in_progress'}]};
    commandBusy=true;
    const promise=execute().then(result=>{outcomes.set(commandId,result as never);return result;}).finally(()=>{commandBusy=false;gate.end();inFlight.delete(commandId);});
    inFlight.set(commandId,promise);return promise;
  }
  function candidateConnection(provider: 'coinbase'|'robinhood_crypto',fingerprint:string,at:number,label?:string):ProfileConnectionV2 {
    const candidate=profileConnectionV2(input.profileId,provider,fingerprint,at,label);
    const existing=getProfileConnectionV2(input.profileId,candidate.id,input.database);
    return existing===null?candidate:{...existing,status:'active',updatedAtMs:at,...(label===undefined?{}:{label})};
  }
  function walletView() {
    const names=input.nicknameStore?.read();
    if(names&&!names.ok)return {ok:false as const,issues:[{path:[],code:names.code}]};
    return {ok:true as const,value:{profileId:input.profileId,revision:names?.value.revision??null,scope:'installation' as const,
      wallets:listVerifiedWalletIdentities(input.profileId,input.database).map(w=>({id:w.id,connectionId:w.connection_id,
        provider:w.provider,identityKind:w.identity_kind,maskedSuffix:w.masked_suffix,
        accountRefIds:listProviderAccountRefs(input.profileId,w.connection_id,input.database).filter(a=>w.identity_kind==='portfolio'||a.providerIdentityHash===w.identity_hash).map(a=>a.id),
        nickname:names?.value.names[w.canonical_key]??null,removed:connectionRemoval(input.profileId,w.connection_id,input.database)?.state==='removed'}))}};
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
      if(!commandBusy){if(!gate.begin())return {ok:false,issues:[{path:[],code:'connection_operation_in_progress'}]};try{await expireRobinhoodSetups();await ensureLegacyCoinbase();}finally{gate.end();}}
      return { ok: true, value: { asOfMs: input.clock.nowMs(),
        connections: listProfileConnectionsV2(input.profileId, input.database).filter(c=>connectionRemoval(input.profileId,c.id,input.database)?.state!=='removed').map((item) => view(item, input.database)) } };
    },
    'connections.removal-preview': (payload:{readonly connectionId:string})=>{
      const preview=connectorRemovalPreview(input.profileId,payload.connectionId,input.clock.nowMs(),input.database,gate.isBusy());
      return preview===null?{ok:false,issues:[{path:[],code:'connection_not_found'}]}:{ok:true,value:preview};
    },
    'connections.remove': (payload:{readonly commandId:string;readonly connectionId:string;readonly revision:string;readonly confirmed:boolean})=>
      once(payload.commandId,()=>removal.remove(payload.connectionId,payload.commandId,payload.revision,payload.confirmed)),
    'wallets.list':()=>walletView(),
    'wallets.nickname.set':(payload:{readonly commandId:string;readonly walletId:string;readonly nickname:string|null;readonly revision:string|null})=>once(payload.commandId,async()=>{
      const wallet=listVerifiedWalletIdentities(input.profileId,input.database).find(w=>w.id===payload.walletId);
      if(wallet===undefined)return {ok:false,issues:[{path:[],code:'wallet_not_found'}]};
      if(input.nicknameStore===undefined)return {ok:false,issues:[{path:[],code:'nickname_store_unavailable'}]};
      const result=input.nicknameStore.set(wallet.canonical_key,payload.nickname,payload.revision);
      return result.ok?{ok:true,value:{walletId:wallet.id,nickname:payload.nickname===null?null:normalizeWalletNickname(payload.nickname),revision:result.value.revision,scope:'installation'}}:
        {ok:false,issues:[{path:[],code:result.code}]};
    }),
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
        const connection = candidateConnection(payload.provider,sha256Hex(parsed.credentials.apiKey),atMs,payload.label);
        const written = await writeConnectionSecret(input.secrets, secretRef(connection), serializeRobinhoodCryptoCredentials(parsed.credentials));
        if (!written.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
        try { saveProfileConnectionV2(connection, input.database); } catch {
          await removeConnectionSecret(input.secrets, secretRef(connection));
          return { ok: false, issues: [{ path: [], code: 'connection_storage_rejected' }] };
        }
        if(connectionRemoval(input.profileId,connection.id,input.database)!==null)setConnectionRemoval(connection,payload.commandId,'reactivated',input.clock.nowMs(),input.database);
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
      const connection = candidateConnection('coinbase',sha256Hex(parsed.credentials.keyName),atMs,payload.label);
      if(listVerifiedWalletIdentities(input.profileId,input.database).some(w=>w.connection_id===connection.id&&w.identity_hash!==sha256Hex(verified.portfolioUuid.trim().toLowerCase())))return {ok:false,issues:[{path:[],code:'wallet_identity_changed'}]};
      const written = await writeConnectionSecret(input.secrets, secretRef(connection), serializeCoinbaseCredentials(parsed.credentials));
      if (!written.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      try { saveProfileConnectionV2(connection, input.database); } catch {
        await removeConnectionSecret(input.secrets, secretRef(connection));
        return { ok: false, issues: [{ path: [], code: 'connection_storage_rejected' }] };
      }
      saveVerifiedWalletIdentity(connection,'portfolio',verified.portfolioUuid,atMs,input.database);
      if(connectionRemoval(input.profileId,connection.id,input.database)!==null)setConnectionRemoval(connection,payload.commandId,'reactivated',input.clock.nowMs(),input.database);
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
      const now = input.clock.nowMs(), connection = candidateConnection('robinhood_crypto',sha256Hex(parsed.credentials.apiKey),now,payload.label);
      const permanent = await writeConnectionSecret(input.secrets, secretRef(connection), serializeRobinhoodCryptoCredentials(parsed.credentials));
      if (!permanent.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      const verified = await readConnectionSecret(input.secrets, secretRef(connection));
      if (!verified.ok || verified.value !== serializeRobinhoodCryptoCredentials(parsed.credentials)) {
        await removeConnectionSecret(input.secrets, secretRef(connection));
        return { ok: false, issues: [{ path: [], code: 'secret_verification_failed' }] };
      }
      saveProfileConnectionV2(connection, input.database);
      if(connectionRemoval(input.profileId,connection.id,input.database)!==null)setConnectionRemoval(connection,payload.commandId,'reactivated',input.clock.nowMs(),input.database);
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
    'connections.disconnect': async (payload: { readonly commandId: string; readonly connectionId: string; readonly revision?:string; readonly confirmed?:boolean }) => once(payload.commandId, async () => {
      const preview=connectorRemovalPreview(input.profileId,payload.connectionId,input.clock.nowMs(),input.database);
      if(preview===null)return {ok:false,issues:[{path:[],code:'connection_not_found'}]};
      const result=await removal.remove(payload.connectionId,payload.commandId,payload.revision??preview.revision,payload.revision===undefined||payload.confirmed===true,false);
      const connection=getProfileConnectionV2(input.profileId,payload.connectionId,input.database);
      return result.ok&&connection!==null?{ok:true,value:view(connection,input.database)}:result;
    }),
    'connections.sync': async (payload: { readonly commandId: string; readonly connectionId: string }) => once(payload.commandId, async () => {
      const connection = getProfileConnectionV2(input.profileId, payload.connectionId, input.database);
      return connection === null ? { ok: false, issues: [{ path: ['connectionId'], code: 'connection_not_found' }] } : sync(connection);
    }),
    'portfolio.current': () => {
      const snapshot = getCurrentUnifiedPortfolioSnapshotV2(input.profileId,input.database);
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
