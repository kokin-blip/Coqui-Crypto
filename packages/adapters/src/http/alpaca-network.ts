/** Only fixed transport codes may cross the diagnostic boundary. Never copy messages/URLs. */
const NETWORK_CODES = [
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
] as const;
export type AlpacaNetworkCode = typeof NETWORK_CODES[number];
export function safeAlpacaNetworkCode(value: unknown): AlpacaNetworkCode | null {
  return typeof value === 'string' && NETWORK_CODES.includes(value as AlpacaNetworkCode) ? value as AlpacaNetworkCode : null;
}
export function alpacaNetworkFailureCode(error: unknown): AlpacaNetworkCode | null {
  let cause = error;
  for (let depth = 0; depth < 4 && cause !== null && typeof cause === 'object'; depth += 1) {
    const item = cause as { code?: unknown; cause?: unknown };
    const code = safeAlpacaNetworkCode(item.code);
    if (code) return code;
    cause = item.cause;
  }
  return null;
}
