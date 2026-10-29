import { it, expect } from 'vitest';
import { advanceProspectiveBook, identifiedBudgetFact, capitalHash } from '@coqui/core';
import { prospectiveFixture, DAY } from './helpers/capital-prospective.js';
it('a zero-friction modeled fill cannot satisfy a friction-bearing or actual-paper action minimum', () => {
  const f = prospectiveFixture();
  try {
    const cost = { ...f.design.costs[0]!, feeRate:'0', fixedUsd:'0', slippageBps:'0', spreadBps:'0', impactBps:'0' };
    const design = identifiedBudgetFact({ ...f.design, costs:[cost] }), arm = design.arms.find(x => x.id === 'passive')!, opening = design.openings.find(x => x.capitalUsd === '500')!;
    let row = advanceProspectiveBook(design,capitalHash('r'),capitalHash('c0'),f.frame(20*DAY,'100'),arm,opening,cost,null);
    row = advanceProspectiveBook(design,capitalHash('r'),capitalHash('c1'),f.frame(21*DAY,'100'),arm,opening,cost,row);
    expect(row.book.positions['coinbase|spot|BTC-USD']).toBe('2.5');
    expect(row.actions.modeledFrictionBearing).toBe(0); expect(row.actions.actualPaperSettled).toBe(0);
  } finally { f.close(); }
});
