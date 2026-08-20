import type { HttpClient } from '../http/index.js';
import {
  publicationTime,
  referenceFailure,
  referenceRecord,
  type ReferenceResult,
} from './common.js';

/** Host alternative.me is served from — used to scope the shared rate limiter. */
export const FEAR_GREED_HOST = 'api.alternative.me';

const FEAR_GREED_URL = `https://${FEAR_GREED_HOST}/fng/?limit=1`;

/**
 * One reading of the Crypto Fear & Greed Index: a 0–100 market-sentiment gauge
 * where 0 is extreme fear and 100 extreme greed.
 *
 * Ported from the predecessor's `src/core/market/feargreed.ts`. It is decision
 * *context* for a human reading a dashboard and is never a trading input; the
 * service layer marks it non-signal and the strategy engine cannot reach it.
 */
export interface FearGreedReading {
  /** 0–100; lower is more fear. */
  readonly value: number;
  /** The source's own bucket label, e.g. "Fear", "Extreme Greed". */
  readonly classification: string;
}

interface FearGreedRow {
  readonly value?: unknown;
  readonly value_classification?: unknown;
  readonly timestamp?: unknown;
}

/**
 * Bucket label used only when the source omits one. Mirrors alternative.me's
 * published bands so a fallback label never contradicts the provider's own.
 */
export function classifyFearGreed(value: number): string {
  if (value < 25) return 'Extreme Fear';
  if (value < 45) return 'Fear';
  if (value < 55) return 'Neutral';
  if (value < 75) return 'Greed';
  return 'Extreme Greed';
}

export async function fetchFearGreed(
  http: HttpClient,
  signal?: AbortSignal,
): Promise<ReferenceResult<FearGreedReading>> {
  const response = await http.getJson<unknown>(FEAR_GREED_URL, signal ? { signal } : undefined);
  if (!response.ok) return { ok: false, code: referenceFailure(response) };

  const body = referenceRecord(response.data);
  const rows = body === null ? null : body['data'];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, code: 'invalid_response' };
  }

  const row = referenceRecord(rows[0]) as FearGreedRow | null;
  if (row === null) return { ok: false, code: 'invalid_response' };

  const raw = Number(row.value);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
    return { ok: false, code: 'invalid_response' };
  }

  const value = Math.round(raw);
  const provided = row.value_classification;
  const classification =
    typeof provided === 'string' && provided.trim().length > 0 && provided.length <= 64
      ? provided.trim()
      : classifyFearGreed(value);

  return {
    ok: true,
    value: { value, classification },
    observedAtMs: publicationTime(row.timestamp),
  };
}
