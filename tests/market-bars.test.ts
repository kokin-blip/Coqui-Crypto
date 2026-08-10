import { describe, expect, it } from 'vitest';
import {
  alignMarketBars,
  buildDecisionMarketDataset,
  dailyCloseRowsToMarketBars,
  utcDayKey,
  instrumentKey,
  type InstrumentKey,
  type MarketBar,
} from '../packages/core/src/index.js';

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
const ETH = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });

function bar(assetId: InstrumentKey, day: number, close: number, complete = true): MarketBar {
  const startTimeMs = START + day * DAY;
  return {
    assetId,
    source: 'fixture',
    interval: '1d',
    startTimeMs,
    endTimeMs: startTimeMs + DAY,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 100,
    isComplete: complete,
    retrievedAtMs: START + 10 * DAY,
  };
}

describe('timestamped market bars', () => {
  it('normalizes UTC day keys independently of local timezone', () => {
    expect(utcDayKey(Date.UTC(2024, 0, 1, 23, 59))).toBe('2024-01-01');
  });

  it('aligns by actual day key rather than equal tail length', () => {
    const aligned = alignMarketBars(
      {
        [BTC]: [bar(BTC, 0, 10), bar(BTC, 1, 11), bar(BTC, 2, 12)],
        [ETH]: [bar(ETH, 0, 20), bar(ETH, 2, 22), bar(ETH, 3, 23)],
      },
      [BTC, ETH],
      { nowMs: START + 20 * DAY },
    );
    expect(aligned.dayKeys).toEqual(['2024-01-01', '2024-01-03']);
    expect(aligned.closesById).toEqual({ [BTC]: [10, 12], [ETH]: [20, 22] });
    expect(aligned.report.droppedBarsByAsset).toEqual({ [BTC]: 1, [ETH]: 1 });
    expect(aligned.report.missingKeysByAsset).toEqual({
      [BTC]: ['2024-01-04'],
      [ETH]: ['2024-01-02'],
    });
  });

  it('reports requested assets that have no rows instead of dropping them', () => {
    const aligned = buildDecisionMarketDataset(
      { [BTC]: [bar(BTC, 0, 10), bar(BTC, 1, 11)] },
      [BTC, ETH],
      { nowMs: START + 20 * DAY },
    );
    expect(aligned.assets).toEqual([BTC, ETH]);
    expect(aligned.dayKeys).toEqual([]);
    expect(aligned.report.missingKeysByAsset[ETH]).toEqual(['2024-01-01', '2024-01-02']);
  });

  it('excludes incomplete bars and reports duplicate intervals', () => {
    const aligned = alignMarketBars(
      { [BTC]: [bar(BTC, 0, 10), bar(BTC, 0, 11), bar(BTC, 1, 12, false)] },
      [BTC],
      { nowMs: START + 20 * DAY },
    );
    expect(aligned.dayKeys).toEqual(['2024-01-01']);
    expect(aligned.report.duplicateKeysByAsset[BTC]).toEqual(['2024-01-01']);
    expect(aligned.report.issues.some((issue) => issue.code === 'incomplete')).toBe(true);
  });

  it('marks the current UTC candle incomplete with a safety delay', () => {
    const nowMs = START + DAY + 60_000;
    const rows = dailyCloseRowsToMarketBars(BTC, [{ timeS: START / 1000, close: 10 }], {
      nowMs,
      completenessDelayMs: 5 * 60_000,
    });
    expect(rows[0]?.isComplete).toBe(false);
    expect(rows[0]?.quality).toBe('close_only_legacy');
  });

  it('produces a stable content hash', () => {
    const input = { [BTC]: [bar(BTC, 0, 10)] };
    const a = alignMarketBars(input, [BTC], { nowMs: START + 20 * DAY });
    const b = alignMarketBars(input, [BTC], { nowMs: START + 20 * DAY });
    expect(a.report.datasetHash).toBe(b.report.datasetHash);
  });

  it('rejects wrong identities and calendar gaps missing from every asset', () => {
    const wrongIdentity = alignMarketBars(
      { [BTC]: [bar(ETH, 0, 10)] },
      [BTC],
      { policy: 'reject-on-gap', nowMs: START + 20 * DAY },
    );
    expect(wrongIdentity.dayKeys).toEqual([]);
    expect(wrongIdentity.report.issues[0]?.code).toBe('provider_mismatch');

    const commonGap = alignMarketBars(
      {
        [BTC]: [bar(BTC, 0, 10), bar(BTC, 2, 12)],
        [ETH]: [bar(ETH, 0, 20), bar(ETH, 2, 22)],
      },
      [BTC, ETH],
      { policy: 'reject-on-gap', nowMs: START + 20 * DAY },
    );
    expect(commonGap.dayKeys).toEqual([]);
    expect(commonGap.report.missingKeysByAsset[BTC]).toEqual(['2024-01-02']);
    expect(commonGap.report.missingKeysByAsset[ETH]).toEqual(['2024-01-02']);
  });

  it('returns a deeply immutable decision snapshot without freezing caller input', () => {
    const sourceBar = bar(BTC, 0, 10);
    const dataset = buildDecisionMarketDataset(
      { [BTC]: [sourceBar] }, [BTC], { nowMs: START + 20 * DAY },
    );
    expect(Object.isFrozen(dataset)).toBe(true);
    expect(Object.isFrozen(dataset.barsById[BTC])).toBe(true);
    expect(Object.isFrozen(dataset.barsById[BTC]?.[0])).toBe(true);
    expect(Object.isFrozen(sourceBar)).toBe(false);
  });
});
