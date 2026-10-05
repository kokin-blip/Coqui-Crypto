import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export interface WalletNicknameSnapshot {
  readonly revision: string | null;
  readonly names: Readonly<Record<string, string>>;
}
export type WalletNicknameStoreResult<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly code: 'nickname_store_unavailable' | 'nickname_store_corrupt' | 'nickname_store_conflict' | 'invalid_nickname' };
export interface WalletNicknameStore {
  read(): WalletNicknameStoreResult<WalletNicknameSnapshot>;
  set(key: string, nickname: string | null, expectedRevision: string | null): WalletNicknameStoreResult<WalletNicknameSnapshot>;
}

export function normalizeWalletNickname(value: string): string | null {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return null;
  const name = value.trim().replace(/\s+/gu, ' ');
  return name.length > 0 && name.length <= 80 ? name : null;
}

/** Installation metadata. Never part of a profile database, backup or evidence pack. */
export function createFileWalletNicknameStore(path: string): WalletNicknameStore {
  const hash = (raw: string): string => createHash('sha256').update(raw).digest('hex');
  return {
    read() {
      let raw: string;
      try { raw = readFileSync(path, 'utf8'); }
      catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? { ok: true, value: { revision: null, names: {} } }
          : { ok: false, code: 'nickname_store_unavailable' };
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        const record = parsed as Record<string, unknown>;
        if (record['schemaVersion'] !== 1 || Object.keys(record).length !== 2 ||
          record['names'] === null || typeof record['names'] !== 'object' || Array.isArray(record['names'])) throw new Error();
        const names = record['names'] as Record<string, unknown>;
        if (Object.entries(names).some(([key, name]) => !/^[a-f0-9]{64}$/u.test(key) ||
          typeof name !== 'string' || normalizeWalletNickname(name) !== name)) throw new Error();
        return { ok: true, value: { revision: hash(raw), names: Object.freeze(names as Record<string, string>) } };
      } catch { return { ok: false, code: 'nickname_store_corrupt' }; }
    },
    set(key, nickname, expectedRevision) {
      if (!/^[a-f0-9]{64}$/u.test(key) || nickname !== null && normalizeWalletNickname(nickname) === null) {
        return { ok: false, code: 'invalid_nickname' };
      }
      const current = this.read();
      if (!current.ok) return current;
      if (current.value.revision !== expectedRevision) return { ok: false, code: 'nickname_store_conflict' };
      const names = Object.fromEntries(Object.entries(current.value.names).filter(([existing]) => existing !== key));
      if (nickname !== null) names[key] = normalizeWalletNickname(nickname)!;
      const raw = `${JSON.stringify({ schemaVersion: 1, names }, null, 2)}\n`;
      const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
      try {
        writeFileSync(temporary, raw, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        renameSync(temporary, path);
        return { ok: true, value: { revision: hash(raw), names: Object.freeze(names) } };
      } catch {
        try { rmSync(temporary, { force: true }); } catch { /* best effort */ }
        return { ok: false, code: 'nickname_store_unavailable' };
      }
    },
  };
}
