import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export type PersonIntroState = 'not_started' | 'in_progress' | 'skipped' | 'portfolio_ready';

export interface PersonIdentityV1 {
  readonly schemaVersion: 1;
  readonly displayName: string | null;
  readonly introState: PersonIntroState;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly skippedAtMs: number | null;
  readonly completedAtMs: number | null;
}

export interface PersonIdentitySnapshot {
  readonly value: PersonIdentityV1;
  readonly revision: string;
}

export interface PersonIdentityStore {
  read(): { readonly ok: true; readonly value: PersonIdentitySnapshot | null } |
    { readonly ok: false; readonly code: 'unavailable' | 'corrupt' };
  replace(expectedRevision: string | null, value: PersonIdentityV1):
    { readonly ok: true; readonly revision: string } |
    { readonly ok: false; readonly code: 'unavailable' | 'conflict' | 'invalid_identity' };
}

function safeTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validName(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length < 1 || value.length > 40 || value !== value.trim().replace(/\s+/gu, ' ')) return false;
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  });
}

export function parsePersonIdentity(raw: string): PersonIdentityV1 | null {
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'displayName', 'introState', 'createdAtMs', 'updatedAtMs', 'skippedAtMs', 'completedAtMs'];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) return null;
  if (record['schemaVersion'] !== 1 || !validName(record['displayName']) ||
    !['not_started', 'in_progress', 'skipped', 'portfolio_ready'].includes(String(record['introState'])) ||
    !safeTime(record['createdAtMs']) || !safeTime(record['updatedAtMs']) ||
    record['updatedAtMs'] < record['createdAtMs'] ||
    !(record['skippedAtMs'] === null || safeTime(record['skippedAtMs'])) ||
    !(record['completedAtMs'] === null || safeTime(record['completedAtMs']))) return null;
  return Object.freeze(value as PersonIdentityV1);
}

function revision(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function createFilePersonIdentityStore(path: string): PersonIdentityStore {
  if (!path || path.includes('\0')) throw new TypeError('A valid person identity path is required.');
  return {
    read() {
      let raw: string;
      try { raw = readFileSync(path, 'utf8'); }
      catch (error) {
        const code = error !== null && typeof error === 'object' ? (error as Record<string, unknown>)['code'] : undefined;
        return code === 'ENOENT' ? { ok: true, value: null } : { ok: false, code: 'unavailable' };
      }
      const value = parsePersonIdentity(raw);
      return value === null ? { ok: false, code: 'corrupt' } : { ok: true, value: { value, revision: revision(raw) } };
    },
    replace(expectedRevision, value) {
      const parsed = parsePersonIdentity(JSON.stringify(value));
      if (parsed === null) return { ok: false, code: 'invalid_identity' };
      const current = this.read();
      if (!current.ok && current.code !== 'corrupt') return { ok: false, code: 'unavailable' };
      const currentRevision = current.ok ? current.value?.revision ?? null : null;
      if (currentRevision !== expectedRevision) return { ok: false, code: 'conflict' };
      const raw = `${JSON.stringify(parsed, null, 2)}\n`;
      const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
      try {
        writeFileSync(temporary, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        renameSync(temporary, path);
        return { ok: true, revision: revision(raw) };
      } catch {
        try { rmSync(temporary, { force: true }); } catch { /* best-effort cleanup */ }
        return { ok: false, code: 'unavailable' };
      }
    },
  };
}
