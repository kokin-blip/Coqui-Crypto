import { describe, expect, it } from 'vitest';
import {
  decimal,
  disposalYears,
  disposalsToCsv,
  summarizeDisposals,
  type AssetRef,
  type Disposal,
} from '../packages/core/src/index.js';

const NOW = Date.parse('2026-06-15T00:00:00Z');
const THIS_YEAR = Date.parse('2026-03-01T00:00:00Z');
const LAST_YEAR = Date.parse('2025-08-01T00:00:00Z');

function asset(name = 'BTC'): AssetRef {
  return {
    instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
    symbol: 'BTC',
    name,
    baseAsset: 'BTC',
    quoteAsset: 'USD',
    coingeckoId: 'bitcoin',
  };
}

function disposal(
  id: string,
  realizedPnlUsd: string,
  longTerm: boolean,
  disposedAt: number,
): Disposal {
  return {
    id,
    asset: asset(),
    quantity: decimal('1'),
    proceedsUsd: decimal(new String(100 + Number(realizedPnlUsd)).toString()),
    costBasisUsd: decimal('100'),
    realizedPnlUsd: decimal(realizedPnlUsd),
    longTerm,
    disposedAt,
    method: 'fifo',
    source: 'manual',
  };
}

describe('tax summaries and export', () => {
  it('returns exact zero totals for an empty ledger', () => {
    expect(summarizeDisposals([], NOW)).toEqual({
      ytdRealizedUsd: '0',
      allTimeRealizedUsd: '0',
      shortTermRealizedUsd: '0',
      longTermRealizedUsd: '0',
      ytdShortTermUsd: '0',
      ytdLongTermUsd: '0',
      disposalCount: 0,
    });
  });

  it('splits exact realized totals by term and UTC tax year', () => {
    const summary = summarizeDisposals(
      [
        disposal('a', '500.10', false, THIS_YEAR),
        disposal('b', '300.20', true, THIS_YEAR),
        disposal('c', '-200.05', false, LAST_YEAR),
      ],
      NOW,
    );
    expect(summary).toMatchObject({
      disposalCount: 3,
      allTimeRealizedUsd: '600.25',
      shortTermRealizedUsd: '300.05',
      longTermRealizedUsd: '300.2',
      ytdRealizedUsd: '800.3',
      ytdShortTermUsd: '500.1',
      ytdLongTermUsd: '300.2',
    });
  });

  it('exports oldest-first CSV, filters UTC year, and quotes cells', () => {
    const recent = { ...disposal('a', '250', true, THIS_YEAR), asset: asset('Bitcoin, the OG') };
    const old = disposal('b', '-100', false, LAST_YEAR);
    const csv = disposalsToCsv([recent, old]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('2025-08-01');
    expect(lines[2]).toContain('"Bitcoin, the OG"');
    expect(disposalsToCsv([recent, old], 2026)).toContain('250.00');
    expect(disposalYears([recent, old])).toEqual([2026, 2025]);
  });
});
