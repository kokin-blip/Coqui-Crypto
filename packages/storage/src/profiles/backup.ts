import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase } from '../sqlite/index.js';
import type { StoredProfileDeletionImpact } from '../repositories/profile-impact.js';

export type StoredProfileBackupCredentialKind = 'coinbase' | 'advisor_gemini';

export interface CreateProfileBackupInput {
  readonly backupId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly dbFilename: string;
  readonly createdAtMs: number;
  readonly sourceManifestRevision: string;
  readonly impact: StoredProfileDeletionImpact;
  readonly credentialKinds: readonly StoredProfileBackupCredentialKind[];
}

export interface VerifiedProfileBackup {
  readonly formatVersion: 1;
  readonly backupId: string;
  readonly artifactName: string;
  readonly profileId: string;
  readonly createdAtMs: number;
  readonly sourceManifestRevision: string;
  readonly schemaVersion: number;
  readonly databaseSha256: string;
  readonly manifestSha256: string;
  readonly totalDurableRecords: number;
  readonly impact: StoredProfileDeletionImpact;
  readonly credentialKinds: readonly StoredProfileBackupCredentialKind[];
  readonly credentialsIncluded: false;
  readonly verified: true;
}

export type ProfileBackupErrorCode =
  | 'invalid_input'
  | 'source_unavailable'
  | 'destination_unavailable'
  | 'artifact_conflict'
  | 'verification_failed';

export type ProfileBackupResult =
  | { readonly ok: true; readonly backup: VerifiedProfileBackup }
  | { readonly ok: false; readonly code: ProfileBackupErrorCode };

export interface ProfileBackupStore {
  create(input: CreateProfileBackupInput): Promise<ProfileBackupResult>;
  verify(artifactName: string, expectedProfileId?: string): Promise<ProfileBackupResult>;
}

interface BackupManifestV1 {
  readonly formatVersion: 1;
  readonly backupId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly sourceDbFilename: string;
  readonly databaseFilename: 'profile.db';
  readonly createdAtMs: number;
  readonly sourceManifestRevision: string;
  readonly schemaVersion: number;
  readonly databaseSha256: string;
  readonly impact: StoredProfileDeletionImpact;
  readonly totalDurableRecords: number;
  readonly credentialKinds: readonly StoredProfileBackupCredentialKind[];
  readonly credentialsIncluded: false;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const ARTIFACT = /^coqui-profile-backup-([0-9]+)-([0-9a-f-]{36})$/iu;
const IMPACT_KEYS = [
  'openTaxLots', 'disposals', 'portfolioEvidenceRecords', 'paperEvidenceRecords',
  'researchEvidenceRecords', 'alertEvidenceRecords', 'importEvidenceRecords',
  'operationalEvidenceRecords',
] as const;

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function inside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validImpact(value: unknown): value is StoredProfileDeletionImpact {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === IMPACT_KEYS.length && IMPACT_KEYS.every(
    (key) => safeInteger(record[key]),
  );
}

function totalImpact(value: StoredProfileDeletionImpact): number | null {
  const total = IMPACT_KEYS.reduce((sum, key) => sum + value[key], 0);
  return Number.isSafeInteger(total) ? total : null;
}

function validCredentialKinds(value: unknown): value is readonly StoredProfileBackupCredentialKind[] {
  return Array.isArray(value) && value.length === new Set(value).size && value.every(
    (kind) => kind === 'coinbase' || kind === 'advisor_gemini',
  );
}

function safeFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !value.includes('\0') && !value.includes('/') && !value.includes('\\') && value.endsWith('.db');
}

function validInput(input: CreateProfileBackupInput): boolean {
  return UUID_V4.test(input.backupId) && PROFILE_ID.test(input.profileId) &&
    typeof input.profileName === 'string' && input.profileName.length > 0 &&
    input.profileName.length <= 40 && safeFilename(input.dbFilename) &&
    safeInteger(input.createdAtMs) && HASH.test(input.sourceManifestRevision) &&
    validImpact(input.impact) && totalImpact(input.impact) !== null &&
    validCredentialKinds(input.credentialKinds);
}

function schemaVersion(database: DatabaseSync): number | null {
  const row = database.prepare('PRAGMA user_version').get() as Record<string, unknown>;
  const version = row['user_version'];
  return safeInteger(version) ? version : null;
}

function databaseValid(path: string, expectedSchema?: number): { ok: true; schema: number } | { ok: false } {
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    const integrity = database.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
    const schema = schemaVersion(database);
    if (
      integrity['integrity_check'] !== 'ok' || schema === null ||
      (expectedSchema !== undefined && schema !== expectedSchema)
    ) return { ok: false };
    return { ok: true, schema };
  } catch {
    return { ok: false };
  } finally {
    database?.close();
  }
}

function parseManifest(raw: string): BackupManifestV1 | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expected = [
    'formatVersion', 'backupId', 'profileId', 'profileName', 'sourceDbFilename',
    'databaseFilename', 'createdAtMs', 'sourceManifestRevision', 'schemaVersion',
    'databaseSha256', 'impact', 'totalDurableRecords', 'credentialKinds',
    'credentialsIncluded',
  ];
  if (Object.keys(record).length !== expected.length || expected.some((key) => !Object.hasOwn(record, key))) {
    return null;
  }
  if (
    record['formatVersion'] !== 1 || typeof record['backupId'] !== 'string' ||
    !UUID_V4.test(record['backupId']) || typeof record['profileId'] !== 'string' ||
    !PROFILE_ID.test(record['profileId']) || typeof record['profileName'] !== 'string' ||
    record['profileName'].length === 0 || record['profileName'].length > 40 ||
    !safeFilename(record['sourceDbFilename']) || record['databaseFilename'] !== 'profile.db' ||
    !safeInteger(record['createdAtMs']) || typeof record['sourceManifestRevision'] !== 'string' ||
    !HASH.test(record['sourceManifestRevision']) || !safeInteger(record['schemaVersion']) ||
    typeof record['databaseSha256'] !== 'string' || !HASH.test(record['databaseSha256']) ||
    !validImpact(record['impact']) || !safeInteger(record['totalDurableRecords']) ||
    totalImpact(record['impact']) !== record['totalDurableRecords'] ||
    !validCredentialKinds(record['credentialKinds']) || record['credentialsIncluded'] !== false
  ) return null;
  return record as unknown as BackupManifestV1;
}

function artifactView(
  artifactName: string,
  manifest: BackupManifestV1,
  manifestSha256: string,
): VerifiedProfileBackup {
  return Object.freeze({
    formatVersion: 1,
    backupId: manifest.backupId,
    artifactName,
    profileId: manifest.profileId,
    createdAtMs: manifest.createdAtMs,
    sourceManifestRevision: manifest.sourceManifestRevision,
    schemaVersion: manifest.schemaVersion,
    databaseSha256: manifest.databaseSha256,
    manifestSha256,
    totalDurableRecords: manifest.totalDurableRecords,
    impact: Object.freeze({ ...manifest.impact }),
    credentialKinds: Object.freeze([...manifest.credentialKinds]),
    credentialsIncluded: false,
    verified: true,
  });
}

/** Create and verify atomic profile backup directories under one explicit root. */
export function createFileProfileBackupStore(
  profilesDirectory: string,
  backupDirectory: string,
): ProfileBackupStore {
  if (!profilesDirectory || !backupDirectory) throw new TypeError('Profile and backup roots are required.');

  async function verify(artifactName: string, expectedProfileId?: string): Promise<ProfileBackupResult> {
    const match = ARTIFACT.exec(artifactName);
    if (!match || !safeInteger(Number(match[1])) || !UUID_V4.test(match[2]!)) {
      return { ok: false, code: 'invalid_input' };
    }
    try {
      mkdirSync(backupDirectory, { recursive: true });
      const root = realpathSync(backupDirectory);
      const artifactCandidate = resolve(root, artifactName);
      if (!inside(root, artifactCandidate) || !existsSync(artifactCandidate)) {
        return { ok: false, code: 'source_unavailable' };
      }
      const artifactPath = realpathSync(artifactCandidate);
      if (!inside(root, artifactPath)) return { ok: false, code: 'verification_failed' };
      const manifestCandidate = resolve(artifactPath, 'manifest.json');
      const databaseCandidate = resolve(artifactPath, 'profile.db');
      if (!inside(artifactPath, manifestCandidate) || !inside(artifactPath, databaseCandidate)) {
        return { ok: false, code: 'verification_failed' };
      }
      const manifestPath = realpathSync(manifestCandidate);
      const databasePath = realpathSync(databaseCandidate);
      if (!inside(artifactPath, manifestPath) || !inside(artifactPath, databasePath)) {
        return { ok: false, code: 'verification_failed' };
      }
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest = parseManifest(raw);
      if (
        manifest === null ||
        (expectedProfileId !== undefined && manifest.profileId !== expectedProfileId) ||
        hashFile(databasePath) !== manifest.databaseSha256 ||
        !databaseValid(databasePath, manifest.schemaVersion).ok
      ) return { ok: false, code: 'verification_failed' };
      return { ok: true, backup: artifactView(artifactName, manifest, hashText(raw)) };
    } catch {
      return { ok: false, code: 'verification_failed' };
    }
  }

  return Object.freeze({
    async create(input: CreateProfileBackupInput): Promise<ProfileBackupResult> {
      if (!validInput(input)) return { ok: false, code: 'invalid_input' };
      let temporaryPath: string | null = null;
      let stage: 'source' | 'destination' | 'verification' = 'source';
      try {
        mkdirSync(backupDirectory, { recursive: true });
        const profileRoot = realpathSync(profilesDirectory);
        const backupRoot = realpathSync(backupDirectory);
        const sourceCandidate = resolve(profileRoot, input.dbFilename);
        if (!inside(profileRoot, sourceCandidate) || !existsSync(sourceCandidate)) {
          return { ok: false, code: 'source_unavailable' };
        }
        const sourcePath = realpathSync(sourceCandidate);
        if (!inside(profileRoot, sourcePath)) return { ok: false, code: 'source_unavailable' };
        const artifactName = `coqui-profile-backup-${input.createdAtMs}-${input.backupId}`;
        const finalPath = resolve(backupRoot, artifactName);
        temporaryPath = resolve(backupRoot, `.tmp-${input.backupId}`);
        if (!inside(backupRoot, finalPath) || !inside(backupRoot, temporaryPath)) {
          return { ok: false, code: 'invalid_input' };
        }
        if (existsSync(finalPath) || existsSync(temporaryPath)) {
          return { ok: false, code: 'artifact_conflict' };
        }
        stage = 'destination';
        mkdirSync(temporaryPath);
        const databasePath = resolve(temporaryPath, 'profile.db');
        const source = new DatabaseSync(sourcePath, { readOnly: true, allowExtension: false });
        try {
          backupDatabase(source, databasePath);
        } finally {
          source.close();
        }
        stage = 'verification';
        const checked = databaseValid(databasePath);
        if (!checked.ok) return { ok: false, code: 'verification_failed' };
        const total = totalImpact(input.impact)!;
        const manifest: BackupManifestV1 = {
          formatVersion: 1,
          backupId: input.backupId,
          profileId: input.profileId,
          profileName: input.profileName,
          sourceDbFilename: input.dbFilename,
          databaseFilename: 'profile.db',
          createdAtMs: input.createdAtMs,
          sourceManifestRevision: input.sourceManifestRevision,
          schemaVersion: checked.schema,
          databaseSha256: hashFile(databasePath),
          impact: { ...input.impact },
          totalDurableRecords: total,
          credentialKinds: [...input.credentialKinds].sort(),
          credentialsIncluded: false,
        };
        const raw = `${JSON.stringify(manifest, null, 2)}\n`;
        writeFileSync(resolve(temporaryPath, 'manifest.json'), raw, { encoding: 'utf8', flag: 'wx' });
        renameSync(temporaryPath, finalPath);
        temporaryPath = null;
        return {
          ok: true,
          backup: artifactView(artifactName, manifest, hashText(raw)),
        };
      } catch {
        return {
          ok: false,
          code: stage === 'source' ? 'source_unavailable'
            : stage === 'destination' ? 'destination_unavailable'
              : 'verification_failed',
        };
      } finally {
        if (temporaryPath !== null) {
          try {
            rmSync(temporaryPath, { recursive: true, force: true });
          } catch {
            // Cleanup is best effort and restricted to the validated temporary child.
          }
        }
      }
    },
    verify,
  });
}
