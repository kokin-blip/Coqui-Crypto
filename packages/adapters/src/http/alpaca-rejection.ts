export interface AlpacaRejection {
  readonly providerCode: number | null;
  readonly reason: 'insufficient_buying_power' | 'insufficient_balance' | 'permission_denied' | 'unspecified';
  readonly requestId: string | null;
}

/** Retain known categories and numeric codes, never raw messages, balances, or headers. */
export async function readAlpacaRejection(response: Response): Promise<AlpacaRejection> {
  const request = response.headers.get('x-request-id');
  const requestId = request !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(request) ? request : null;
  let providerCode: number | null = null, reason: AlpacaRejection['reason'] = 'unspecified';
  try {
    const raw: unknown = await response.json();
    if (raw && typeof raw === 'object' && 'code' in raw && typeof raw.code === 'number' &&
        Number.isSafeInteger(raw.code) && raw.code >= 40300000 && raw.code <= 40399999) providerCode = raw.code;
    if (raw && typeof raw === 'object' && 'message' in raw && typeof raw.message === 'string') {
      if (/^insufficient (?:non.marginable )?buying power\b/iu.test(raw.message)) reason = 'insufficient_buying_power';
      else if (/^insufficient (?:balance|qty)\b/iu.test(raw.message)) reason = 'insufficient_balance';
      else if (/^(?:account (?:is )?not authorized|insufficient permission)\b/iu.test(raw.message)) reason = 'permission_denied';
    }
  } catch { /* The received refusal remains a refusal even without structured details. */ }
  return { providerCode, reason, requestId };
}
