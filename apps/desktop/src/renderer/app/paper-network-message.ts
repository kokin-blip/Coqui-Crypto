import type { ChannelResponse } from '@coqui/contracts';

type Failure = NonNullable<ChannelResponse<'parallel.paper.status'>['reconciliationAttention']['latestFailure']>;
export function paperNetworkMessage(failure: Failure | null): string | null {
  if (!failure || failure.reason !== 'alpaca_unavailable') return null;
  switch (failure.networkCode) {
    case 'ENOTFOUND': case 'EAI_AGAIN':
      return 'The Alpaca address could not be resolved. Check your internet connection and DNS settings, then retry reconciliation.';
    case 'ECONNREFUSED':
      return 'The connection to Alpaca was refused. Check whether a proxy or firewall is blocking the connection, then retry reconciliation.';
    case 'ECONNRESET': case 'UND_ERR_SOCKET':
      return 'The connection to Alpaca was interrupted. Check your internet connection, then retry reconciliation.';
    case 'EHOSTUNREACH': case 'ENETUNREACH':
      return 'The network could not reach Alpaca. Check your internet connection, VPN, or proxy, then retry reconciliation.';
    case 'ETIMEDOUT': case 'UND_ERR_CONNECT_TIMEOUT': case 'UND_ERR_HEADERS_TIMEOUT': case 'UND_ERR_BODY_TIMEOUT':
      return 'The Alpaca connection timed out. Check your internet connection and retry reconciliation.';
    case 'ERR_TLS_CERT_ALTNAME_INVALID': case 'CERT_HAS_EXPIRED': case 'DEPTH_ZERO_SELF_SIGNED_CERT': case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'The secure connection to Alpaca could not be verified. Check the system clock and any proxy or certificate configuration. Certificate checks remain enabled.';
    default:
      return failure.httpStatus === null
        ? 'The Alpaca request failed without a recorded transport cause. Retry reconciliation to capture a new diagnostic.'
        : `Alpaca returned HTTP ${failure.httpStatus}. Coqui will retry while open; trading remains paused.`;
  }
}
