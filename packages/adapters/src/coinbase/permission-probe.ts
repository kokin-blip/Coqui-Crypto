import type { HttpFailure } from '../http/index.js';
import {
  COINBASE_API_HOST,
  type CoinbaseReadHttpClient,
} from './auth.js';

export type CoinbaseProbeErrorCode =
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'http'
  | 'invalid_permissions'
  | 'missing_view_permission'
  | 'excess_permissions'
  | 'accounts_unreadable';

export interface CoinbaseProbeDiagnostics {
  permissionHttpStatus: number | null;
  accountsHttpStatus: number | null;
  traceId: string | null;
}

export type CoinbasePermissionProbeResult =
  | {
      ok: true;
      portfolioUuid: string | null;
      diagnostics: CoinbaseProbeDiagnostics;
    }
  | {
      ok: false;
      code: CoinbaseProbeErrorCode;
      error: string;
      diagnostics: CoinbaseProbeDiagnostics;
    };

const PERMISSIONS_URL =
  `https://${COINBASE_API_HOST}/api/v3/brokerage/key_permissions`;
const ACCOUNTS_URL =
  `https://${COINBASE_API_HOST}/api/v3/brokerage/accounts?limit=1`;

function classifyFailure(failure: HttpFailure): {
  code: CoinbaseProbeErrorCode;
  error: string;
} {
  if (failure.reason === 'timeout') {
    return { code: 'timeout', error: 'Coinbase did not respond in time.' };
  }
  if (failure.status === 0) {
    return { code: 'network', error: 'Could not reach Coinbase.' };
  }
  if (failure.status === 401) {
    return { code: 'unauthorized', error: 'Coinbase rejected authentication.' };
  }
  if (failure.status === 403) {
    return { code: 'forbidden', error: 'Coinbase denied the permission probe.' };
  }
  if (failure.status === 429) {
    return { code: 'rate_limited', error: 'Coinbase is rate-limiting requests.' };
  }
  return { code: 'http', error: `Coinbase request failed (HTTP ${failure.status}).` };
}

function diagnostics(
  permissionHttpStatus: number | null,
  accountsHttpStatus: number | null,
  traceId: string | null,
): CoinbaseProbeDiagnostics {
  return { permissionHttpStatus, accountsHttpStatus, traceId };
}

/**
 * Fail-closed connect-time proof: the key must explicitly report View=true,
 * Trade=false, Transfer=false, then successfully read the accounts endpoint.
 */
export async function probeCoinbaseViewOnlyPermissions(
  http: CoinbaseReadHttpClient,
): Promise<CoinbasePermissionProbeResult> {
  const permissions = await http.getJson<unknown>(PERMISSIONS_URL);
  if (!permissions.ok) {
    if (permissions.reason === 'parse') {
      return {
        ok: false,
        code: 'invalid_permissions',
        error: 'Coinbase returned an invalid permissions response.',
        diagnostics: diagnostics(permissions.status, null, permissions.traceId ?? null),
      };
    }
    const classified = classifyFailure(permissions);
    return {
      ok: false,
      ...classified,
      diagnostics: diagnostics(
        permissions.status || null,
        null,
        permissions.traceId ?? null,
      ),
    };
  }
  const data = typeof permissions.data === 'object' && permissions.data !== null
    ? permissions.data as Record<string, unknown>
    : {};
  if (
    typeof data['can_view'] !== 'boolean' ||
    typeof data['can_trade'] !== 'boolean' ||
    typeof data['can_transfer'] !== 'boolean'
  ) {
    return {
      ok: false,
      code: 'invalid_permissions',
      error: 'Coinbase returned an incomplete permissions response.',
      diagnostics: diagnostics(permissions.status, null, null),
    };
  }
  if (data['can_view'] !== true) {
    return {
      ok: false,
      code: 'missing_view_permission',
      error: 'This Coinbase key does not have View permission.',
      diagnostics: diagnostics(permissions.status, null, null),
    };
  }
  if (data['can_trade'] === true || data['can_transfer'] === true) {
    return {
      ok: false,
      code: 'excess_permissions',
      error: 'Coqui accepts only keys without Trade or Transfer permission.',
      diagnostics: diagnostics(permissions.status, null, null),
    };
  }

  const accounts = await http.getJson<unknown>(ACCOUNTS_URL);
  if (!accounts.ok) {
    if (accounts.reason === 'parse') {
      return {
        ok: false,
        code: 'accounts_unreadable',
        error: 'Coinbase returned an invalid accounts response.',
        diagnostics: diagnostics(
          permissions.status,
          accounts.status,
          accounts.traceId ?? null,
        ),
      };
    }
    const classified = classifyFailure(accounts);
    return {
      ok: false,
      ...classified,
      diagnostics: diagnostics(
        permissions.status,
        accounts.status || null,
        accounts.traceId ?? null,
      ),
    };
  }
  const accountData = typeof accounts.data === 'object' && accounts.data !== null
    ? accounts.data as Record<string, unknown>
    : {};
  if (!Array.isArray(accountData['accounts'])) {
    return {
      ok: false,
      code: 'accounts_unreadable',
      error: 'Coinbase returned an invalid accounts response.',
      diagnostics: diagnostics(permissions.status, accounts.status, null),
    };
  }
  const portfolioUuid = typeof data['portfolio_uuid'] === 'string' &&
    data['portfolio_uuid'].trim().length > 0
    ? data['portfolio_uuid'].trim()
    : null;
  return {
    ok: true,
    portfolioUuid,
    diagnostics: diagnostics(permissions.status, accounts.status, null),
  };
}
