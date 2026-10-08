import type { ParallelPaperEvent } from '@coqui/storage';

/** Separate provider connectivity, price freshness, and incomplete accounting evidence. */
export function parallelBrokerEvidence(events: readonly ParallelPaperEvent[], nowMs: number) {
  const stream = events.findLast((event) => event.kind === 'readiness' && event.detail['operation'] === 'trade_stream');
  const quote = events.findLast((event) => event.kind === 'readiness' && event.detail['operation'] === 'quote');
  const quoteAssets = ['BTC/USD', 'ETH/USD', 'LTC/USD'].map(symbol => {
    const latest = events.findLast(event => event.kind === 'readiness' && event.detail['operation'] === 'quote' &&
      (Array.isArray(event.detail['quoteTimestamps']) && event.detail['quoteTimestamps'].some(row => row.symbol === symbol) ||
       event.detail['status'] === 'unavailable' && (!Array.isArray(event.detail['quoteSymbols']) || event.detail['quoteSymbols'].includes(symbol))));
    const row = Array.isArray(latest?.detail['quoteTimestamps']) ? latest.detail['quoteTimestamps'].find(item => item.symbol === symbol) : null;
    const quoteAtMs = typeof row?.atMs === 'number' && Number.isSafeInteger(row.atMs) && row.atMs >= 0 ? row.atMs : null;
    const ageSeconds = quoteAtMs === null || quoteAtMs - nowMs > 5000 ? null : Math.max(0, Math.floor((nowMs - quoteAtMs) / 1000));
    const status = latest?.detail['status'] === 'unavailable' ? 'unavailable' as const : ageSeconds === null ? 'unknown' as const :
      nowMs - quoteAtMs! > 60_000 ? 'stale' as const : 'fresh' as const;
    return { symbol, quoteAtMs, receivedAtMs: latest?.at ?? null, ageSeconds, status };
  });
  const hasAssetEvidence = events.some(event => event.kind === 'readiness' && event.detail['operation'] === 'quote' && Array.isArray(event.detail['quoteTimestamps']));
  const assetQuoteStatus = quoteAssets.some(row => row.status === 'unavailable') ? 'unavailable' as const : quoteAssets.some(row => row.status === 'stale') ? 'stale' as const : quoteAssets.every(row => row.status === 'fresh') ? 'fresh' as const : 'unknown' as const;
  const at = quote?.detail['oldestQuoteAtMs'];
  const quoteAtMs = hasAssetEvidence ? quoteAssets.every(row => row.quoteAtMs !== null) ? Math.min(...quoteAssets.map(row => row.quoteAtMs!)) : null :
    typeof at === 'number' && Number.isSafeInteger(at) && at >= 0 ? at : null;
  const latestFill = events.filter((event) => event.kind === 'external_fill').reduce<number | null>((latest, event) => {
    const time = typeof event.detail['at'] === 'string' ? Date.parse(event.detail['at']) : NaN;
    return Number.isFinite(time) ? Math.max(latest ?? 0, time) : latest;
  }, null);
  const feeTimes = events.filter((event) => event.kind === 'broker_activity_metadata' &&
    ['CFEE', 'FEE'].includes(String(event.detail['activityType']))).flatMap((event) => {
    const time = typeof event.detail['createdAt'] === 'string' ? Date.parse(event.detail['createdAt']) : NaN;
    return Number.isFinite(time) ? [time] : [];
  });
  const latestFeeCreatedAtMs = feeTimes.length ? Math.max(...feeTimes) : null;
  const snapshot = events.findLast((event) => event.kind === 'broker_position_snapshot');
  const lastSuccess = events.findLast((event) => event.kind === 'readiness' && event.detail['operation'] === 'broker_reconciliation' && event.detail['status'] === 'validated');
  const lastAttempt = events.findLast((event) => event.kind === 'submit_attempt');
  const updates = events.filter((event) => event.kind === 'broker_trade_update');
  const lastExecution = updates.at(-1)?.detail['at'];
  const lastExecutionAtMs = typeof lastExecution === 'string' ? Date.parse(lastExecution) : NaN;
  return {
    tradeStream: stream?.detail['status'] === 'listening' ? 'listening' as const : stream?.detail['status'] === 'connecting' ? 'connecting' as const : 'unavailable' as const,
    quoteStatus: hasAssetEvidence ? assetQuoteStatus : quote?.detail['status'] === 'unavailable' ? 'unavailable' as const : quoteAtMs === null ? 'unknown' as const :
      nowMs - quoteAtMs > 60_000 || quoteAtMs - nowMs > 5000 ? 'stale' as const : 'fresh' as const,
    quoteAtMs, quoteAssets, latestFillAtMs: latestFill, latestFeeCreatedAtMs,
    feeCoverage: events.some((event) => event.kind === 'external_fill') ? 'unconfirmed' as const : 'no_fills' as const,
    positionStatus: !snapshot || (lastAttempt && events.indexOf(lastAttempt) > events.indexOf(snapshot)) ? 'unknown' as const : lastSuccess && events.indexOf(lastSuccess) > events.indexOf(snapshot) ? 'reconciled' as const : 'unreconciled' as const,
    capturedExecutionCount: updates.length,
    lastExecutionAtMs: Number.isSafeInteger(lastExecutionAtMs) && lastExecutionAtMs >= 0 ? lastExecutionAtMs : null,
  };
}
