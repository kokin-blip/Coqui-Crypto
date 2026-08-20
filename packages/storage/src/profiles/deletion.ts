import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import type { StoredProfileBackupCredentialKind } from './backup.js';
import type { ProfileManifestStore, ProfileManifestV1 } from './manifest.js';

export interface CommitProfileDeletionInput {
  readonly operationId: string;
  readonly profileId: string;
  readonly backupId: string;
  readonly backupArtifactName: string;
  readonly sourceManifestRevision: string;
  readonly createdAtMs: number;
  readonly credentialKinds: readonly StoredProfileBackupCredentialKind[];
}

export interface StoredProfileDeletionTicket {
  readonly operationId: string;
  readonly profileId: string;
  readonly backupId: string;
  readonly backupArtifactName: string;
  readonly createdAtMs: number;
  readonly databaseRemoved: boolean;
  readonly credentialKinds: readonly StoredProfileBackupCredentialKind[];
  readonly removedCredentialKinds: readonly StoredProfileBackupCredentialKind[];
}

export type ProfileDeletionStoreErrorCode =
  | 'invalid_input'
  | 'profile_not_found'
  | 'active_profile'
  | 'last_profile'
  | 'source_unavailable'
  | 'manifest_unavailable'
  | 'manifest_conflict'
  | 'journal_unavailable'
  | 'recovery_corrupt';

export type ProfileDeletionStoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ProfileDeletionStoreErrorCode };

export interface ProfileDeletionStore {
  commit(input: CommitProfileDeletionInput): Promise<ProfileDeletionStoreResult<StoredProfileDeletionTicket>>;
  pending(): Promise<ProfileDeletionStoreResult<readonly StoredProfileDeletionTicket[]>>;
  cleanupDatabase(operationId: string): Promise<ProfileDeletionStoreResult<StoredProfileDeletionTicket>>;
  recordCredentialRemoved(
    operationId: string,
    kind: StoredProfileBackupCredentialKind,
  ): Promise<ProfileDeletionStoreResult<StoredProfileDeletionTicket>>;
  complete(operationId: string): Promise<ProfileDeletionStoreResult<true>>;
}

interface ProfileDeletionJournalV1 {
  readonly formatVersion: 1;
  readonly operationId: string;
  readonly profileId: string;
  readonly dbFilename: string;
  readonly backupId: string;
  readonly backupArtifactName: string;
  readonly sourceManifestRevision: string;
  readonly createdAtMs: number;
  readonly profileRemoved: boolean;
  readonly databaseRemoved: boolean;
  readonly credentialKinds: readonly StoredProfileBackupCredentialKind[];
  readonly removedCredentialKinds: readonly StoredProfileBackupCredentialKind[];
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const ARTIFACT = /^coqui-profile-backup-[0-9]+-[0-9a-f-]{36}$/iu;
const JOURNAL = /^profile-deletion-([0-9a-f-]{36})\.json$/iu;
const MAX_PENDING_DELETIONS = 64;

function inside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !value.includes('\0') && !value.includes('/') && !value.includes('\\') && value.endsWith('.db');
}

function validKinds(value: unknown): value is readonly StoredProfileBackupCredentialKind[] {
  return Array.isArray(value) && value.length === new Set(value).size && value.every(
    (kind) => kind === 'coinbase' || kind === 'advisor_gemini',
  );
}

function validInput(value: CommitProfileDeletionInput): boolean {
  return UUID_V4.test(value.operationId) && PROFILE_ID.test(value.profileId) &&
    UUID_V4.test(value.backupId) && ARTIFACT.test(value.backupArtifactName) &&
    HASH.test(value.sourceManifestRevision) && safeInteger(value.createdAtMs) &&
    validKinds(value.credentialKinds);
}

function parseJournal(raw: string): ProfileDeletionJournalV1 | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = [
    'formatVersion', 'operationId', 'profileId', 'dbFilename', 'backupId',
    'backupArtifactName', 'sourceManifestRevision', 'createdAtMs', 'profileRemoved',
    'databaseRemoved', 'credentialKinds', 'removedCredentialKinds',
  ];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
    return null;
  }
  const credentialKinds = record['credentialKinds'];
  const removedCredentialKinds = record['removedCredentialKinds'];
  if (
    record['formatVersion'] !== 1 || typeof record['operationId'] !== 'string' ||
    !UUID_V4.test(record['operationId']) || typeof record['profileId'] !== 'string' ||
    !PROFILE_ID.test(record['profileId']) || !safeFilename(record['dbFilename']) ||
    typeof record['backupId'] !== 'string' || !UUID_V4.test(record['backupId']) ||
    typeof record['backupArtifactName'] !== 'string' || !ARTIFACT.test(record['backupArtifactName']) ||
    typeof record['sourceManifestRevision'] !== 'string' || !HASH.test(record['sourceManifestRevision']) ||
    !safeInteger(record['createdAtMs']) || typeof record['profileRemoved'] !== 'boolean' ||
    typeof record['databaseRemoved'] !== 'boolean' || !validKinds(credentialKinds) ||
    !validKinds(removedCredentialKinds) ||
    removedCredentialKinds.some((kind) => !credentialKinds.includes(kind))
  ) return null;
  return record as unknown as ProfileDeletionJournalV1;
}

function ticket(journal: ProfileDeletionJournalV1): StoredProfileDeletionTicket {
  return Object.freeze({
    operationId: journal.operationId,
    profileId: journal.profileId,
    backupId: journal.backupId,
    backupArtifactName: journal.backupArtifactName,
    createdAtMs: journal.createdAtMs,
    databaseRemoved: journal.databaseRemoved,
    credentialKinds: Object.freeze([...journal.credentialKinds]),
    removedCredentialKinds: Object.freeze([...journal.removedCredentialKinds]),
  });
}

function withoutProfile(manifest: ProfileManifestV1, profileId: string): ProfileManifestV1 {
  const profiles = manifest.profiles
    .filter((profile) => profile.id !== profileId)
    .sort((left, right) => left.order - right.order)
    .map((profile, order) => ({ ...profile, order }));
  return { ...manifest, profiles };
}

/** Durable profile-removal journal around the non-transactional filesystem boundary. */
export function createFileProfileDeletionStore(
  profilesDirectory: string,
  recoveryDirectory: string,
  manifestStore: ProfileManifestStore,
): ProfileDeletionStore {
  if (!profilesDirectory || !recoveryDirectory) throw new TypeError('Profile deletion roots are required.');

  function roots(): { profiles: string; recovery: string } {
    mkdirSync(recoveryDirectory, { recursive: true });
    return {
      profiles: realpathSync(profilesDirectory),
      recovery: realpathSync(recoveryDirectory),
    };
  }

  function journalPath(recoveryRoot: string, operationId: string): string | null {
    if (!UUID_V4.test(operationId)) return null;
    const path = resolve(recoveryRoot, `profile-deletion-${operationId.toLowerCase()}.json`);
    return inside(recoveryRoot, path) ? path : null;
  }

  function durableWrite(path: string, value: ProfileDeletionJournalV1, replace: boolean): boolean {
    const temporary = `${path}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx',
      });
      const descriptor = openSync(temporary, 'r+');
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      if (!replace && existsSync(path)) return false;
      renameSync(temporary, path);
      return true;
    } catch {
      try {
        if (existsSync(temporary)) unlinkSync(temporary);
      } catch {
        // Cleanup is best effort and restricted to the journal sibling.
      }
      return false;
    }
  }

  function readJournal(recoveryRoot: string, operationId: string): ProfileDeletionJournalV1 | null {
    const path = journalPath(recoveryRoot, operationId);
    if (path === null || !existsSync(path)) return null;
    try {
      return parseJournal(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }

  function removeDatabaseFiles(
    profileRoot: string,
    journal: ProfileDeletionJournalV1,
  ): ProfileDeletionJournalV1 {
    const paths = ['', '-wal', '-shm'].map((suffix) => resolve(profileRoot, `${journal.dbFilename}${suffix}`));
    if (paths.some((path) => !inside(profileRoot, path))) return journal;
    try {
      for (const path of paths) {
        if (existsSync(path)) unlinkSync(path);
      }
    } catch {
      return journal;
    }
    return { ...journal, databaseRemoved: paths.every((path) => !existsSync(path)) };
  }

  async function pending(): Promise<ProfileDeletionStoreResult<readonly StoredProfileDeletionTicket[]>> {
    let resolved: ReturnType<typeof roots>;
    try {
      resolved = roots();
    } catch {
      return { ok: false, code: 'journal_unavailable' };
    }
    let names: string[];
    try {
      names = readdirSync(resolved.recovery).filter((name) => JOURNAL.test(name)).sort();
    } catch {
      return { ok: false, code: 'journal_unavailable' };
    }
    if (names.length > MAX_PENDING_DELETIONS) return { ok: false, code: 'recovery_corrupt' };
    const loaded = manifestStore.read();
    if (!loaded.ok) return { ok: false, code: 'manifest_unavailable' };
    const tickets: StoredProfileDeletionTicket[] = [];
    for (const name of names) {
      const match = JOURNAL.exec(name);
      const operationId = match?.[1];
      if (!operationId) return { ok: false, code: 'recovery_corrupt' };
      const path = journalPath(resolved.recovery, operationId);
      const journal = readJournal(resolved.recovery, operationId);
      if (path === null || journal === null) return { ok: false, code: 'recovery_corrupt' };
      const profileStillExists = loaded.value?.manifest.profiles.some(
        (profile) => profile.id === journal.profileId,
      ) ?? false;
      if (profileStillExists && journal.profileRemoved) {
        return { ok: false, code: 'recovery_corrupt' };
      }
      if (profileStillExists) {
        try {
          unlinkSync(path);
        } catch {
          return { ok: false, code: 'journal_unavailable' };
        }
        continue;
      }
      const committed = journal.profileRemoved ? journal : { ...journal, profileRemoved: true };
      if (!journal.profileRemoved && !durableWrite(path, committed, true)) {
        return { ok: false, code: 'journal_unavailable' };
      }
      tickets.push(ticket(committed));
    }
    return { ok: true, value: Object.freeze(tickets) };
  }

  return Object.freeze({
    async commit(
      input: CommitProfileDeletionInput,
    ): Promise<ProfileDeletionStoreResult<StoredProfileDeletionTicket>> {
      if (!validInput(input)) return { ok: false, code: 'invalid_input' };
      let resolved: ReturnType<typeof roots>;
      try {
        resolved = roots();
      } catch {
        return { ok: false, code: 'journal_unavailable' };
      }
      const loaded = manifestStore.read();
      if (!loaded.ok || !loaded.value) return { ok: false, code: 'manifest_unavailable' };
      if (loaded.value.revision !== input.sourceManifestRevision) {
        return { ok: false, code: 'manifest_conflict' };
      }
      const profile = loaded.value.manifest.profiles.find((candidate) => candidate.id === input.profileId);
      if (!profile) return { ok: false, code: 'profile_not_found' };
      if (loaded.value.manifest.profiles.length === 1) return { ok: false, code: 'last_profile' };
      if (loaded.value.manifest.activeProfileId === profile.id) return { ok: false, code: 'active_profile' };
      const sourceCandidate = resolve(resolved.profiles, profile.dbFilename);
      try {
        if (!inside(resolved.profiles, sourceCandidate) || !existsSync(sourceCandidate) ||
          !statSync(sourceCandidate).isFile() || !inside(resolved.profiles, realpathSync(sourceCandidate))) {
          return { ok: false, code: 'source_unavailable' };
        }
      } catch {
        return { ok: false, code: 'source_unavailable' };
      }
      const path = journalPath(resolved.recovery, input.operationId);
      if (path === null || existsSync(path)) return { ok: false, code: 'journal_unavailable' };
      let journal: ProfileDeletionJournalV1 = {
        formatVersion: 1,
        operationId: input.operationId.toLowerCase(),
        profileId: profile.id,
        dbFilename: profile.dbFilename,
        backupId: input.backupId.toLowerCase(),
        backupArtifactName: input.backupArtifactName,
        sourceManifestRevision: input.sourceManifestRevision,
        createdAtMs: input.createdAtMs,
        profileRemoved: false,
        databaseRemoved: false,
        credentialKinds: [...input.credentialKinds].sort(),
        removedCredentialKinds: [],
      };
      if (!durableWrite(path, journal, false)) return { ok: false, code: 'journal_unavailable' };
      const replaced = manifestStore.replace(
        loaded.value.revision,
        withoutProfile(loaded.value.manifest, profile.id),
      );
      if (!replaced.ok) {
        try {
          unlinkSync(path);
        } catch {
          // An uncommitted journal is discarded by `pending` when the profile still exists.
        }
        return {
          ok: false,
          code: replaced.code === 'conflict' ? 'manifest_conflict' : 'manifest_unavailable',
        };
      }
      journal = { ...journal, profileRemoved: true };
      if (!durableWrite(path, journal, true)) return { ok: true, value: ticket(journal) };
      journal = removeDatabaseFiles(resolved.profiles, journal);
      if (!durableWrite(path, journal, true)) return { ok: true, value: ticket(journal) };
      return { ok: true, value: ticket(journal) };
    },

    pending,

    async cleanupDatabase(
      operationId: string,
    ): Promise<ProfileDeletionStoreResult<StoredProfileDeletionTicket>> {
      let resolved: ReturnType<typeof roots>;
      try {
        resolved = roots();
      } catch {
        return { ok: false, code: 'journal_unavailable' };
      }
      const journal = readJournal(resolved.recovery, operationId);
      const path = journalPath(resolved.recovery, operationId);
      if (journal === null || path === null || !journal.profileRemoved) {
        return { ok: false, code: 'recovery_corrupt' };
      }
      const updated = removeDatabaseFiles(resolved.profiles, journal);
      if (!durableWrite(path, updated, true)) return { ok: false, code: 'journal_unavailable' };
      return { ok: true, value: ticket(updated) };
    },

    async recordCredentialRemoved(
      operationId: string,
      kind: StoredProfileBackupCredentialKind,
    ): Promise<ProfileDeletionStoreResult<StoredProfileDeletionTicket>> {
      if (kind !== 'coinbase' && kind !== 'advisor_gemini') return { ok: false, code: 'invalid_input' };
      let resolved: ReturnType<typeof roots>;
      try {
        resolved = roots();
      } catch {
        return { ok: false, code: 'journal_unavailable' };
      }
      const journal = readJournal(resolved.recovery, operationId);
      const path = journalPath(resolved.recovery, operationId);
      if (journal === null || path === null || !journal.profileRemoved ||
        !journal.credentialKinds.includes(kind)) return { ok: false, code: 'recovery_corrupt' };
      const removed = [...new Set([...journal.removedCredentialKinds, kind])].sort() as
        StoredProfileBackupCredentialKind[];
      const updated = { ...journal, removedCredentialKinds: removed };
      if (!durableWrite(path, updated, true)) return { ok: false, code: 'journal_unavailable' };
      return { ok: true, value: ticket(updated) };
    },

    async complete(operationId: string): Promise<ProfileDeletionStoreResult<true>> {
      let resolved: ReturnType<typeof roots>;
      try {
        resolved = roots();
      } catch {
        return { ok: false, code: 'journal_unavailable' };
      }
      const journal = readJournal(resolved.recovery, operationId);
      const path = journalPath(resolved.recovery, operationId);
      if (journal === null || path === null || !journal.profileRemoved || !journal.databaseRemoved ||
        journal.removedCredentialKinds.length !== journal.credentialKinds.length) {
        return { ok: false, code: 'recovery_corrupt' };
      }
      try {
        unlinkSync(path);
      } catch {
        return { ok: false, code: 'journal_unavailable' };
      }
      return { ok: true, value: true };
    },
  });
}
