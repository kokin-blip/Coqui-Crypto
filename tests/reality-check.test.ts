import { describe, expect, it } from 'vitest';
import {
  realityCheckNotices,
  smallPortfolioFloorUsd,
  type RealityCheckInput,
} from '../packages/core/src/index.js';

function input(overrides: Partial<RealityCheckInput> = {}): RealityCheckInput {
  return {
    portfolioValueUsd: 10_000,
    minTradeUsd: 25,
    roundTripCostBps: 85,
    rebalanceEveryDays: 7,
    topAssetWeight: 0.4,
    topAssetSymbol: 'BTC',
    significanceVerdict: 'significant',
    backtestDays: 900,
    paperArmed: false,
    ...overrides,
  };
}

const kinds = (notices: { kind: string }[]) => notices.map((notice) => notice.kind);

describe('realityCheckNotices', () => {
  it('flags a portfolio too small for the strategy to matter', () => {
    const notices = realityCheckNotices(input({ portfolioValueUsd: 34 }));
    expect(kinds(notices)).toContain('portfolio_too_small');
    expect(notices.find((notice) => notice.kind === 'portfolio_too_small')?.body).toContain('DCA');
    expect(kinds(notices)).not.toContain('fee_drag');
    expect(kinds(notices)).not.toContain('tax_friction');
  });

  it('scales the floor with the minimum trade size', () => {
    expect(smallPortfolioFloorUsd(25)).toBe(500);
    expect(kinds(realityCheckNotices(input({ portfolioValueUsd: 499 })))).toContain(
      'portfolio_too_small',
    );
    expect(kinds(realityCheckNotices(input({ portfolioValueUsd: 500 })))).not.toContain(
      'portfolio_too_small',
    );
  });

  it('warns while the edge is statistically unproven', () => {
    expect(kinds(realityCheckNotices(input({ significanceVerdict: 'inconclusive' })))).toContain(
      'edge_unproven',
    );
    expect(kinds(realityCheckNotices(input({ significanceVerdict: 'significant' })))).not.toContain(
      'edge_unproven',
    );
  });

  it('notes short history, concentration, and the paper-to-live gap', () => {
    const notices = realityCheckNotices(
      input({ backtestDays: 150, topAssetWeight: 0.795, topAssetSymbol: 'BTC', paperArmed: true }),
    );
    expect(kinds(notices)).toEqual(expect.arrayContaining(['short_history', 'concentration', 'paper_vs_live']));
    expect(notices.find((notice) => notice.kind === 'concentration')?.title).toContain('80%');
  });

  it('estimates material annual fee drag from cadence', () => {
    expect(kinds(realityCheckNotices(input({ rebalanceEveryDays: 1 })))).toContain('fee_drag');
    expect(kinds(realityCheckNotices(input({ rebalanceEveryDays: 30 })))).not.toContain('fee_drag');
  });

  it('sorts warnings before information notices and omits size notices for an empty book', () => {
    const notices = realityCheckNotices(
      input({ portfolioValueUsd: 100, significanceVerdict: 'inconclusive', paperArmed: true }),
    );
    expect(notices[0]?.severity).toBe('warn');
    expect(kinds(realityCheckNotices(input({ portfolioValueUsd: 0 })))).not.toContain(
      'portfolio_too_small',
    );
  });
});
