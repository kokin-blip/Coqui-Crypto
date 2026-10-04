import { sha256Hex, canonicalJson, type InstrumentKey } from '@coqui/core';
import type { HttpClient } from '../http/index.js';
/** Research assumption: capture the published current-day open within sixty seconds; old opens are refused. */
export async function fetchObservedShadowOpen(http: HttpClient, assets: readonly InstrumentKey[], nowMs: () => number) {
  const start = Math.floor(nowMs() / 86_400_000) * 86_400_000;
  if (nowMs() - start > 60_000) return null;
  const rows = await Promise.all(assets.map(async (asset) => {
    const [venue, productType, product] = asset.split('|');
    if (venue !== 'coinbase' || productType !== 'spot' || !product?.endsWith('-USD')) return null;
    const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=86400&start=${new Date(start).toISOString()}&end=${new Date(start + 86_400_000).toISOString()}`;
    const response = await http.getJson<unknown>(url, { maxElapsedMs: 5000, requestPriority: 'research' });
    if (!response.ok || !Array.isArray(response.data)) return null;
    const row = response.data.find((v: unknown) => Array.isArray(v) && v[0] === start / 1000) as unknown[] | undefined;
    if (!row || typeof row[3] !== 'number' || !Number.isFinite(row[3]) || row[3] <= 0) return null;
    return { asset, open: row[3], source: response.data };
  }));
  const observedAtMs = nowMs();
  if (observedAtMs > start + 60_000 || rows.some((r) => r === null)) return null;
  return { barStartMs: start, observedAtMs, sourceHash: sha256Hex(canonicalJson(rows)), prices: new Map(rows.map((r) => [r!.asset, r!.open])) };
}
