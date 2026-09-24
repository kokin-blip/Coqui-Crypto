import { createAlpacaPaperClient, AlpacaPaperError, type AlpacaPaperCredentials, type SecretStore } from '@coqui/adapters';
import type { Clock } from '@coqui/core';
import { getSetting, removeSetting, setSetting, type Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

const KEY = 'alpaca-paper-credentials' as const;
const ACCOUNT_SETTING = 'alpaca.paper.account.id';
const CHECKED_SETTING = 'alpaca.paper.checked_at';

type PaperClient = ReturnType<typeof createAlpacaPaperClient>;

export function createAlpacaPaperHandlers(input: {
  readonly profileId: string;
  readonly database: Db;
  readonly clock: Clock;
  readonly secrets?: SecretStore;
  readonly clientFactory?: (credentials: AlpacaPaperCredentials) => PaperClient;
  readonly onDisconnect?: () => void;
}): ChannelHandlers {
  const clientFactory = input.clientFactory ?? createAlpacaPaperClient;
  const scope = input.profileId;
  const disconnected = () => ({ state: 'disconnected' as const, accountSuffix: null,
    cashUsd: null, equityUsd: null, lastCheckedAtMs: null, reasonCode: null, paperOnly: true as const });
  const attention = (code: string) => ({ state: 'attention_required' as const,
    accountSuffix: getSetting(ACCOUNT_SETTING, input.database)?.slice(-4) ?? null,
    cashUsd: null, equityUsd: null, lastCheckedAtMs: null, reasonCode: code, paperOnly: true as const });
  const code = (error: unknown): string => error instanceof AlpacaPaperError ? error.code : 'unavailable';

  async function storedCredentials(): Promise<AlpacaPaperCredentials | null> {
    if (input.secrets === undefined) return null;
    const result = await input.secrets.read(KEY, scope);
    if (!result.ok || result.value === null) return null;
    try {
      const value: unknown = JSON.parse(result.value);
      if (typeof value === 'object' && value !== null &&
          'keyId' in value && typeof value.keyId === 'string' &&
          'secretKey' in value && typeof value.secretKey === 'string') {
        return { keyId: value.keyId, secretKey: value.secretKey };
      }
    } catch { /* Corrupt key material never enters an error or log. */ }
    return null;
  }

  async function verify(credentials: AlpacaPaperCredentials) {
    const account = await clientFactory(credentials).account();
    if (!account.id || !account.cash || !account.equity || account.currency !== 'USD' ||
        account.trading_blocked || account.account_blocked || !['ACTIVE', 'PAPER_ONLY'].includes(account.status)) {
      throw new AlpacaPaperError('forbidden');
    }
    return account;
  }

  return {
    'alpaca.paper.status': async () => {
      if (input.secrets === undefined) return { ok: true, value: attention('secret_store_unavailable') };
      const credentials = await storedCredentials();
      if (credentials === null) return { ok: true, value: disconnected() };
      const accountId = getSetting(ACCOUNT_SETTING, input.database);
      if (accountId === null) return { ok: true, value: attention('verification_required') };
      return { ok: true, value: { state: 'connected', accountSuffix: accountId.slice(-4),
        cashUsd: null, equityUsd: null,
        lastCheckedAtMs: Number(getSetting(CHECKED_SETTING, input.database) ?? '0') || null,
        reasonCode: null, paperOnly: true } };
    },
    'alpaca.paper.connect': async (payload: { readonly keyId: string; readonly secretKey: string }) => {
      if (input.secrets === undefined) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      const credentials = { keyId: payload.keyId.trim(), secretKey: payload.secretKey.trim() };
      try {
        const account = await verify(credentials);
        const existing = getSetting(ACCOUNT_SETTING, input.database);
        if (existing !== null && existing !== account.id) {
          return { ok: false, issues: [{ path: [], code: 'disconnect_existing_account_first' }] };
        }
        const saved = await input.secrets.write(KEY, JSON.stringify(credentials), scope);
        if (!saved.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
        setSetting(ACCOUNT_SETTING, account.id, input.database);
        setSetting(CHECKED_SETTING, String(input.clock.nowMs()), input.database);
        return { ok: true, value: { state: 'connected', accountSuffix: account.id.slice(-4),
          cashUsd: account.cash, equityUsd: account.equity,
          lastCheckedAtMs: input.clock.nowMs(), reasonCode: null, paperOnly: true } };
      } catch (error) {
        return { ok: false, issues: [{ path: [], code: `alpaca_${code(error)}` }] };
      }
    },
    'alpaca.paper.refresh': async () => {
      const credentials = await storedCredentials();
      if (credentials === null) return { ok: true, value: attention('credentials_unavailable') };
      try {
        const account = await verify(credentials);
        if (account.id !== getSetting(ACCOUNT_SETTING, input.database)) {
          input.onDisconnect?.();
          return { ok: true, value: attention('account_changed') };
        }
        setSetting(CHECKED_SETTING, String(input.clock.nowMs()), input.database);
        return { ok: true, value: { state: 'connected', accountSuffix: account.id.slice(-4),
          cashUsd: account.cash, equityUsd: account.equity,
          lastCheckedAtMs: input.clock.nowMs(), reasonCode: null, paperOnly: true } };
      } catch (error) {
        input.onDisconnect?.();
        return { ok: true, value: attention(code(error)) };
      }
    },
    'alpaca.paper.disconnect': async () => {
      input.onDisconnect?.();
      if (input.secrets === undefined) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      const removed = await input.secrets.remove(KEY, scope);
      if (!removed.ok) return { ok: false, issues: [{ path: [], code: 'secret_store_unavailable' }] };
      removeSetting(ACCOUNT_SETTING, input.database);
      removeSetting(CHECKED_SETTING, input.database);
      return { ok: true, value: disconnected() };
    },
  } as ChannelHandlers;
}
