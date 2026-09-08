import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { SystemClock } from '@coqui/core';
import {
  AccountsProfileService,
  CoinbaseConnectionService,
  createProfileOperationGate,
  createCoinbaseViewOnlyVerifier,
  type CoinbaseCredentialVerifier,
  type AccountProfileView,
  type PreparedProfileContext,
} from '@coqui/services';
import { createFileProfileManifestStore } from '@coqui/storage';

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
  activeProfile(): AccountProfileView;
  dispose(): void;
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
  const profileOperationGate = createProfileOperationGate();
  let current: CoquiRuntime | null = null;

  const createCandidate = (profileId: string, databaseFilename: string): CoquiRuntime =>
    createRuntime({
      ...options.runtime,
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
        verifier: options.coinbaseVerifier ?? createCoinbaseViewOnlyVerifier(),
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
    ...(options.coinbaseVerifier === undefined ? {} : { coinbaseVerifier: options.coinbaseVerifier }),
    databasePath: join(options.dataDirectory, initial.dbFilename),
    profileId: initial.id,
    ...(options.disableScheduler === undefined
      ? {}
      : { disableScheduler: options.disableScheduler }),
  });

  const switchOutcomes = new Map<string, ServiceResult<unknown>>();
  const coinbaseOutcomes = new Map<string, ServiceResult<unknown>>();
  const globalHandlers: ChannelHandlers = {
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
      coinbaseOutcomes.set(payload.commandId, result);
      return result;
    },
    'accounts.coinbase.disconnect': async (payload: { readonly commandId: string }) => {
      if (coinbaseConnection === null) return serviceFailure('secret_store_unavailable');
      const active = profiles.active();
      const prior = coinbaseOutcomes.get(payload.commandId);
      if (prior !== undefined) return prior;
      const result = active.ok && active.value !== null
        ? await coinbaseConnection.disconnect(active.value.id)
        : serviceFailure('profile_store_unavailable');
      coinbaseOutcomes.set(payload.commandId, result);
      return result;
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
    handlers: () => ({ ...current?.handlers, ...globalHandlers }),
    report: (context, error) => current?.report(context, error),
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
