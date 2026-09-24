import { describe, expect, it } from 'vitest';

import {
  createAlgorithmReport,
  parseAlgorithmSnapshot,
} from '../apps/headless/src/algorithm-report.js';

const BTC = 'coinbase|spot|BTC-USD';

describe('algorithm laboratory report', () => {
  it('exposes the canonical TrendVol reasoning without application state', () => {
    const snapshot = parseAlgorithmSnapshot({
      baseTargets: [{ assetId: BTC, weight: 1 }],
      closesById: { [BTC]: [100, 101, 102] },
      mixCloses: [100, 101, 102],
    });

    const report = createAlgorithmReport(snapshot);

    expect(report.strategy).toBe('trendvol-exploratory-paper-v1');
    expect(report.decision.historyStatus).toBe('insufficient');
    expect(report.trace).toContain('Decision: 1.0000 invested, 0.0000 cash.');
  });

  it('rejects missing decision prices', () => {
    expect(() => parseAlgorithmSnapshot({
      baseTargets: [{ assetId: BTC, weight: 1 }],
      closesById: {},
      mixCloses: [100],
    })).toThrow(`missing_or_invalid_closes:${BTC}`);
  });
});
