import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { profileConnectionV2, sha256Hex, SystemClock } from '@coqui/core';
import {
  AccountsProfileService,
  CoinbaseConnectionService,
  createProfileOperationGate,
  createCoinbaseViewOnlyVerifier,
  PersonIdentityService,
  ProfileReadinessService,
  type CoinbaseCredentialVerifier,
  type AccountProfileView,
  type PreparedProfileContext,
} from '@coqui/services';
import { createFileWalletNicknameStore, saveVerifiedWalletIdentity, listVerifiedWalletIdentities, getProfileConnectionV2, saveProfileConnectionV2, connectionRemoval, setConnectionRemoval, readDetachedProfileDecision, createFilePersonIdentityStore, createFileProfileManifestStore } from '@coqui/storage';

import { activityWatching } from './trading-activity-handlers.js';
import { createRuntime, type CoquiRuntime, type RuntimeOptions } from './composition.js';
import type { ChannelHandlers, ServiceResult } from './dispatch.js';
import { createProfileDatabaseProvisioner } from './profile-contexts.js';

export interface RuntimeProfileControllerOptions {
  readonly dataDirectory: string;
  readonly legacyDatabaseFilename: string;
  /** Test/smoke only: build contexts without starting background cadence. */
  readonly disableScheduler?: boolean;
  readonly runtime: Omit<RuntimeOptions, 'databasePath' | 'profileId' | 'disableScheduler'>;
  /** Offline verifier injection for boundary tests; production uses Coinbase's GET-only probe. */
  readonly coinbaseVerifier?: CoinbaseCredentialVerifier;
}

export interface RuntimeProfileController {
  handlers(): ChannelHandlers;
  report(context: string, error: unknown): void;
  recordDeprecatedChannel(channel: string): void;
  activeProfile(): AccountProfileView;
  dispose(): void;
  suspend(): void;
  resume(): void;
}

function serviceFailure<T>(code: string): ServiceResult<T> {
  return { ok: false, issues: [{ path: [], code }] };
}

/**
 * Own the sole active profile runtime.
 *
 * A candidate runtime is opened with its scheduler stopped. Publication in the
 * manifest happens only after that succeeds; commit then swaps the handler
 * source, starts the candidate scheduler, and disposes the prior runtime. A
 * failed preparation never touches the current runtime.
 */
export function createRuntimeProfileController(
  options: RuntimeProfileControllerOptions,
): RuntimeProfileController {
  const clock = new SystemClock(options.runtime.readSystemTime ?? (() => Date.now()));
  const manifestStore = createFileProfileManifestStore(
    join(options.dataDirectory, 'wallet-profiles.json'),
  );
  const person = new PersonIdentityService(
    createFilePersonIdentityStore(join(options.dataDirectory, 'coqui-person.json')),
    clock,
  );
  const profileOperationGate = createProfileOperationGate();
  const nicknameStore=createFileWalletNicknameStore(join(options.dataDirectory,'wallet-nicknames.json'));
  const accountMetadata={operationGate:profileOperationGate,nicknameStore,manifestStore};
  let current: CoquiRuntime | null = null;
  let legacyVerifiedIdentity: {profileId:string;fingerprint:string;portfolioUuid:string}|null=null;

  const createCandidate = (profileId: string, databaseFilename: string): CoquiRuntime =>
    createRuntime({
      ...options.runtime,
      ...accountMetadata,
      ...(options.coinbaseVerifier === undefined ? {} : { coinbaseVerifier: options.coinbaseVerifier }),
      databasePath: join(options.dataDirectory, databaseFilename),
      profileId,
      disableScheduler: true,
    });

  const profiles = new AccountsProfileService({
    clock,
    idSource: { nextId: randomUUID },
    manifestStore,
    databaseProvisioner: createProfileDatabaseProvisioner(options.dataDirectory),
    contextManager: {
      async prepare(profileId, databaseFilename) {
        let candidate: CoquiRuntime;
        try {
          candidate = createCandidate(profileId, databaseFilename);
        } catch {
          return { ok: false };
        }
        let settled = false;
        const context: PreparedProfileContext = {
          async commit() {
            if (settled) return { ok: false };
            settled = true;
            if (options.disableScheduler !== true) {
              try {
                candidate.startScheduler();
              } catch {
                candidate.dispose();
                return { ok: false };
              }
            }
            const previous = current;
            current = candidate;
            previous?.dispose();
            return { ok: true };
          },
          async abort() {
            if (settled) return;
            settled = true;
            candidate.dispose();
          },
        };
        return { ok: true, context };
      },
    },
    operationGate: profileOperationGate,
  });
  const coinbaseConnection = options.runtime.secrets === undefined
    ? null
    : new CoinbaseConnectionService({
        clock,
        manifestStore,
        secretStore: options.runtime.secrets,
        verifier: {async verify(credentials,signal) {
          const result=await (options.coinbaseVerifier??createCoinbaseViewOnlyVerifier()).verify(credentials,signal);
          if(!result.ok||current===null)return result;
          const loaded=manifestStore.read();if(!loaded.ok||loaded.value===null)return {ok:false as const,reasonCode:'unexpected_failure' as const};
          const id=profileConnectionV2(loaded.value.manifest.activeProfileId,'coinbase',sha256Hex(credentials.keyName),clock.nowMs()).id;
          if(listVerifiedWalletIdentities(loaded.value.manifest.activeProfileId,current.database).some(w=>w.connection_id===id&&w.identity_hash!==sha256Hex(result.portfolioUuid.trim().toLowerCase())))return {ok:false as const,reasonCode:'invalid_portfolio_identity' as const};
          legacyVerifiedIdentity={profileId:loaded.value.manifest.activeProfileId,fingerprint:sha256Hex(credentials.keyName),portfolioUuid:result.portfolioUuid};
          return result;
        }},
        operationGate: profileOperationGate,
      });

  const initialized = profiles.initializeMain(options.legacyDatabaseFilename);
  if (!initialized.ok) throw new Error('Could not initialize profile manifest.');
  const snapshot = manifestStore.read();
  if (!snapshot.ok || snapshot.value === null) throw new Error('Profile manifest unavailable.');
  const initial = snapshot.value.manifest.profiles.find(
    (profile) => profile.id === snapshot.value?.manifest.activeProfileId,
  );
  if (initial === undefined) throw new Error('Active profile is absent from manifest.');
  current = createRuntime({
    ...options.runtime,
    ...accountMetadata,
    ...(options.coinbaseVerifier === undefined ? {} : { coinbaseVerifier: options.coinbaseVerifier }),
    databasePath: join(options.dataDirectory, initial.dbFilename),
    profileId: initial.id,
    ...(options.disableScheduler === undefined
      ? {}
      : { disableScheduler: options.disableScheduler }),
  });

  const switchOutcomes = new Map<string, ServiceResult<unknown>>();
  const coinbaseOutcomes = new Map<string, ServiceResult<unknown>>();
  const personOutcomes = new Map<string, ServiceResult<unknown>>();
  const personCommand = (commandId: string, execute: () => ServiceResult<unknown>): ServiceResult<unknown> => {
    const prior = personOutcomes.get(commandId);
    if (prior !== undefined) return prior;
    const result = execute();
    personOutcomes.set(commandId, result);
    return result;
  };
  function publishLegacyConnection():void {
    if(current===null)return;
    const snapshot=manifestStore.read();if(!snapshot.ok||snapshot.value===null)return;
    const record=snapshot.value.manifest.profiles.find(p=>p.id===snapshot.value!.manifest.activeProfileId);
    if(record?.coinbaseKeyFingerprint===undefined)return;
    const candidate=profileConnectionV2(record.id,'coinbase',record.coinbaseKeyFingerprint,clock.nowMs());
    const prior=getProfileConnectionV2(record.id,candidate.id,current.database);
    const connection=prior===null?candidate:{...prior,status:'active' as const,updatedAtMs:clock.nowMs()};
    saveProfileConnectionV2(connection,current.database);
    if(legacyVerifiedIdentity?.profileId===record.id&&legacyVerifiedIdentity.fingerprint===record.coinbaseKeyFingerprint)saveVerifiedWalletIdentity(connection,'portfolio',legacyVerifiedIdentity.portfolioUuid,clock.nowMs(),current.database);
    legacyVerifiedIdentity=null;
    if(connectionRemoval(record.id,connection.id,current.database)!==null)setConnectionRemoval(connection,'legacy-connect','reactivated',clock.nowMs(),current.database);
  }
  const globalHandlers: ChannelHandlers = {
    'trading.activity.shared': (payload: { readonly productId: string; readonly limit: number }) => {
      if (!profileOperationGate.begin()) return serviceFailure('profile_operation_in_progress');
      try {
        const loaded = manifestStore.read();
        if (!loaded.ok || loaded.value === null) return serviceFailure('profile_store_unavailable');
        const items = []; const unavailableProfiles: string[] = [];
        for (const record of loaded.value.manifest.profiles.filter(p => p.id !== loaded.value?.manifest.activeProfileId).slice(0, payload.limit)) {
          try {
            const detail = readDetachedProfileDecision(options.dataDirectory, record.id, record.dbFilename, payload.productId.replace(/-USD$/, ''));
            const watching = activityWatching(detail, payload.productId, true);
            if (watching !== null) items.push({ profileId: record.id, profileName: record.name, watching, contextOnly: true as const });
          } catch { unavailableProfiles.push(record.id); }
        }
        return { ok: true, value: { items, unavailableProfiles, asOfMs: clock.nowMs() } };
      } finally { profileOperationGate.end(); }
    },
    'app.person': () => person.status(),
    'app.person.set': (payload: { readonly commandId: string; readonly displayName: string }) =>
      personCommand(payload.commandId, () => person.setDisplayName(payload.displayName)),
    'app.onboarding.status': () => person.status(),
    'app.onboarding.skip': (payload: { readonly commandId: string }) =>
      personCommand(payload.commandId, () => person.skip()),
    'app.onboarding.restart': (payload: { readonly commandId: string }) =>
      personCommand(payload.commandId, () => person.restart()),
    'app.onboarding.complete': (payload: { readonly commandId: string }) =>
      personCommand(payload.commandId, () => {
        const active = profiles.active();
        if (current === null || !active.ok || active.value === null ||
            !new ProfileReadinessService(current.database, clock).view(active.value.id).portfolioReady) {
          return serviceFailure('portfolio_not_ready');
        }
        return person.markPortfolioReady();
      }),
    'accounts.coinbase.status': async () => {
      if (coinbaseConnection === null) return serviceFailure('secret_store_unavailable');
      const active = profiles.active();
      return active.ok && active.value !== null
        ? await coinbaseConnection.status(active.value.id)
        : serviceFailure('profile_store_unavailable');
    },
    'accounts.coinbase.connect': async (payload: {
      readonly commandId: string;
      readonly keyName: string;
      readonly privateKey: string;
    }) => {
      if (coinbaseConnection === null) return serviceFailure('secret_store_unavailable');
      const active = profiles.active();
      const prior = coinbaseOutcomes.get(payload.commandId);
      if (prior !== undefined) return prior;
      const result = active.ok && active.value !== null
        ? await coinbaseConnection.connect(active.value.id, {
            keyName: payload.keyName,
            privateKey: payload.privateKey,
          })
        : serviceFailure('profile_store_unavailable');
      if(result.ok)publishLegacyConnection();
      coinbaseOutcomes.set(payload.commandId, result);
      return result;
    },
    'accounts.coinbase.connect-json': async (payload: {
      readonly commandId: string;
      readonly contents: string;
    }) => {
      if (coinbaseConnection === null) return serviceFailure('secret_store_unavailable');
      const active = profiles.active();
      const prior = coinbaseOutcomes.get(payload.commandId);
      if (prior !== undefined) return prior;
      const result = active.ok && active.value !== null
        ? await coinbaseConnection.connectJson(active.value.id, payload.contents)
        : serviceFailure('profile_store_unavailable');
      if(result.ok)publishLegacyConnection();
      coinbaseOutcomes.set(payload.commandId, result);
      return result;
    },
    'accounts.coinbase.disconnect': async (payload: {readonly commandId:string}) => {
      if(coinbaseConnection===null||current===null)return serviceFailure('secret_store_unavailable');
      const active=profiles.active();if(!active.ok||active.value===null)return serviceFailure('profile_store_unavailable');
      const loaded=manifestStore.read();if(!loaded.ok||loaded.value===null)return serviceFailure('profile_store_unavailable');
      const record=loaded.value.manifest.profiles.find(p=>p.id===active.value!.id);
      if(record?.coinbaseKeyFingerprint!==undefined){
        const candidate=profileConnectionV2(record.id,'coinbase',record.coinbaseKeyFingerprint,clock.nowMs());
        if(getProfileConnectionV2(record.id,candidate.id,current.database)===null)saveProfileConnectionV2(candidate,current.database);
        const disconnect=current.handlers['connections.disconnect'];
        const result=await disconnect!({commandId:payload.commandId,connectionId:candidate.id} as never);
        if(!result.ok)return result;
        return coinbaseConnection.status(record.id);
      }
      return coinbaseConnection.disconnect(active.value.id);
    },
    'accounts.profiles': () => {
      const listed = profiles.list();
      if (!listed.ok) return listed;
      const active = listed.value.find((profile) => profile.isActive);
      return active === undefined
        ? serviceFailure('profile_store_corrupt')
        : { ok: true, value: { profiles: listed.value, activeProfile: active } };
    },
    'accounts.profile.switch': async (payload: {
      readonly commandId: string;
      readonly profileId: string;
    }) => {
      const prior = switchOutcomes.get(payload.commandId);
      if (prior !== undefined) return prior;
      const switched = await profiles.switchActive(payload.profileId);
      const outcome: ServiceResult<unknown> = switched.ok
        ? { ok: true, value: { activeProfile: switched.value, switchedAtMs: clock.nowMs() } }
        : switched;
      switchOutcomes.set(payload.commandId, outcome);
      return outcome;
    },
  };

  return {
    suspend: () => current?.scheduler?.suspend(),
    resume: () => current?.scheduler?.resume(),
    handlers: () => ({ ...current?.handlers, ...globalHandlers }),
    report: (context, error) => current?.report(context, error),
    recordDeprecatedChannel: (channel) => current?.recordDeprecatedChannel(channel),
    activeProfile() {
      const active = profiles.active();
      if (!active.ok || active.value === null) throw new Error('Active profile unavailable.');
      return active.value;
    },
    dispose() {
      current?.dispose();
      current = null;
    },
  };
}
