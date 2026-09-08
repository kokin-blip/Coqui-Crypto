import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('connected portfolio product surfaces', () => {
  it('uses connected evidence for the Overview headline and both primary visuals', () => {
    const overview = read('apps/desktop/src/renderer/app/Overview.tsx');
    expect(overview).toContain("useChannel(client, 'portfolio.current'");
    expect(overview).not.toContain("useChannel(client, 'portfolio.view'");
    expect(overview).toContain('<AllocationRing data={allocation} />');
    expect(overview).toContain('<HeldCoinPerformance');
  });

  it('derives simple and advanced Markets defaults from nonzero connected exposures', () => {
    for (const file of ['apps/desktop/src/renderer/app/Markets.tsx',
      'apps/desktop/src/renderer/app/AdvancedMarkets.tsx']) {
      const source = read(file);
      expect(source).toContain("useChannel(client, 'portfolio.current'");
      expect(source).toContain("item.exposureKey !== 'USD'");
      expect(source).toContain('Number(item.quantity) > 0');
    }
    expect(read('apps/desktop/src/renderer/app/AdvancedMarkets.tsx')).toContain('>Portfolio</option>');
  });

  it('labels imported tax lots as accounting instead of current connected balances', () => {
    const portfolio = read('apps/desktop/src/renderer/app/Portfolio.tsx');
    expect(portfolio).toContain('Portfolio accounting');
    expect(portfolio).toContain('IMPORTED ACCOUNTING VALUE');
  });
});
