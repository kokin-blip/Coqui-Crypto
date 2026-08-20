import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

export const PROFILE_ICONS = Object.freeze([
  'wallet', 'star', 'shield', 'rocket', 'leaf', 'diamond',
] as const);

export const PROFILE_COLORS = Object.freeze([
  '#60a5fa', '#34d399', '#fbbf24', '#f472b6',
  '#a78bfa', '#f87171', '#22d3ee', '#c084fc',
] as const);

export type ProfileIcon = typeof PROFILE_ICONS[number];
export type ProfileColor = typeof PROFILE_COLORS[number];

export interface StoredProfileRecord {
  readonly id: string;
  readonly name: string;
  readonly color: ProfileColor;
  readonly icon: ProfileIcon;
  readonly dbFilename: string;
  readonly createdAt: number;
  readonly lastOpenedAt: number;
  readonly order: number;
  readonly coinbaseKeyFingerprint?: string;
  readonly coinbasePortfolioFingerprint?: string;
}

export interface ProfileManifestV1 {
  readonly version: 1;
  readonly activeProfileId: string;
  readonly profiles: readonly StoredProfileRecord[];
}

export type ProfileManifestStoreErrorCode =
  | 'unavailable'
  | 'corrupt'
  | 'conflict'
  | 'invalid_manifest';

export type ProfileManifestReadResult =
  | { readonly ok: true; readonly value: ProfileManifestSnapshot | null }
  | { readonly ok: false; readonly code: 'unavailable' | 'corrupt' };

export type ProfileManifestReplaceResult =
  | { readonly ok: true; readonly revision: string }
  | { readonly ok: false; readonly code: ProfileManifestStoreErrorCode };

export interface ProfileManifestSnapshot {
  readonly manifest: ProfileManifestV1;
  readonly revision: string;
}

export interface ProfileManifestStore {
  read(): ProfileManifestReadResult;
  replace(
    expectedRevision: string | null,
    manifest: ProfileManifestV1,
  ): ProfileManifestReplaceResult;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const REQUIRED_PROFILE_KEYS = [
  'id', 'name', 'color', 'icon', 'dbFilename', 'createdAt', 'lastOpenedAt', 'order',
] as const;
const OPTIONAL_PROFILE_KEYS = [
  'coinbaseKeyFingerprint', 'coinbasePortfolioFingerprint',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function safeTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function profileId(value: unknown): value is string {
  return value === 'main' || typeof value === 'string' && UUID_V4.test(value);
}

function safeFilename(value: unknown, id: string): value is string {
  if (
    typeof value !== 'string' || value.length === 0 || value.length > 128 ||
    value.includes('\0') || basename(value) !== value || !value.endsWith('.db')
  ) return false;
  return id === 'main' || value === `wallet-${id}.db`;
}

function parseProfile(value: unknown): StoredProfileRecord | null {
  if (!isRecord(value) || !exactKeys(value, REQUIRED_PROFILE_KEYS, OPTIONAL_PROFILE_KEYS)) {
    return null;
  }
  const id = value['id'];
  const name = value['name'];
  const color = value['color'];
  const icon = value['icon'];
  const dbFilename = value['dbFilename'];
  const createdAt = value['createdAt'];
  const lastOpenedAt = value['lastOpenedAt'];
  const order = value['order'];
  const keyFingerprint = value['coinbaseKeyFingerprint'];
  const portfolioFingerprint = value['coinbasePortfolioFingerprint'];
  if (
    !profileId(id) || typeof name !== 'string' || name.length === 0 || name.length > 40 ||
    name !== name.trim().replace(/\s+/gu, ' ') ||
    typeof color !== 'string' || !(PROFILE_COLORS as readonly string[]).includes(color) ||
    typeof icon !== 'string' || !(PROFILE_ICONS as readonly string[]).includes(icon) ||
    !safeFilename(dbFilename, id) || !safeTime(createdAt) || !safeTime(lastOpenedAt) ||
    lastOpenedAt < createdAt || typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0 ||
    keyFingerprint !== undefined && (typeof keyFingerprint !== 'string' || !HASH.test(keyFingerprint)) ||
    portfolioFingerprint !== undefined &&
      (typeof portfolioFingerprint !== 'string' || !HASH.test(portfolioFingerprint))
  ) return null;
  const profile: StoredProfileRecord = {
    id, name, color: color as ProfileColor, icon: icon as ProfileIcon,
    dbFilename, createdAt, lastOpenedAt, order,
  };
  return {
    ...profile,
    ...(typeof keyFingerprint === 'string' ? { coinbaseKeyFingerprint: keyFingerprint } : {}),
    ...(typeof portfolioFingerprint === 'string'
      ? { coinbasePortfolioFingerprint: portfolioFingerprint }
      : {}),
  };
}

/** Parse a predecessor-compatible manifest while rejecting partial or ambiguous state. */
export function parseProfileManifest(raw: string): ProfileManifestV1 | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  // Accept the predecessor's field names on disk, then expose Coqui terminology.
  if (!exactKeys(value, ['version', 'activeWalletId', 'wallets'])) return null;
  if (value['version'] !== 1 || !Array.isArray(value['wallets'])) return null;
  const profiles = value['wallets'].map(parseProfile);
  if (profiles.length === 0 || profiles.some((profile) => profile === null)) return null;
  const records = profiles as StoredProfileRecord[];
  const ids = new Set(records.map((profile) => profile.id));
  const filenames = new Set(records.map((profile) => profile.dbFilename));
  const orders = records.map((profile) => profile.order).sort((left, right) => left - right);
  if (
    ids.size !== records.length || filenames.size !== records.length ||
    typeof value['activeWalletId'] !== 'string' || !ids.has(value['activeWalletId']) ||
    orders.some((order, index) => order !== index)
  ) return null;
  return {
    version: 1,
    activeProfileId: value['activeWalletId'],
    profiles: records,
  };
}

function serialized(manifest: ProfileManifestV1): string | null {
  const predecessorShape = {
    version: manifest.version,
    activeWalletId: manifest.activeProfileId,
    wallets: manifest.profiles,
  };
  const raw = `${JSON.stringify(predecessorShape, null, 2)}\n`;
  return parseProfileManifest(raw) === null ? null : raw;
}

function revision(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Atomic, revision-checked storage for the global profile manifest. */
export function createFileProfileManifestStore(manifestPath: string): ProfileManifestStore {
  if (!manifestPath || manifestPath.includes('\0')) {
    throw new TypeError('A valid profile manifest path is required.');
  }
  return {
    read() {
      let raw: string;
      try {
        raw = readFileSync(manifestPath, 'utf8');
      } catch (error) {
        const code = isRecord(error) ? error['code'] : undefined;
        return code === 'ENOENT'
          ? { ok: true, value: null }
          : { ok: false, code: 'unavailable' };
      }
      const manifest = parseProfileManifest(raw);
      return manifest === null
        ? { ok: false, code: 'corrupt' }
        : { ok: true, value: { manifest, revision: revision(raw) } };
    },
    replace(expectedRevision, manifest) {
      const raw = serialized(manifest);
      if (raw === null) return { ok: false, code: 'invalid_manifest' };
      const current = this.read();
      if (!current.ok) return current;
      const actualRevision = current.value?.revision ?? null;
      if (actualRevision !== expectedRevision) return { ok: false, code: 'conflict' };
      const temporaryPath = `${manifestPath}.tmp-${process.pid}-${randomUUID()}`;
      try {
        writeFileSync(temporaryPath, raw, { encoding: 'utf8', flag: 'wx' });
        renameSync(temporaryPath, manifestPath);
        return { ok: true, revision: revision(raw) };
      } catch {
        try {
          rmSync(temporaryPath, { force: true });
        } catch {
          // A failed best-effort cleanup must not replace the safe store error.
        }
        return { ok: false, code: 'unavailable' };
      }
    },
  };
}
