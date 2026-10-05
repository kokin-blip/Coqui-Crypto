import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('connected portfolio product surfaces', () => {
  it('keeps connected assets separate from simulated portfolio value', () => {
    const summary = read('apps/desktop/src/renderer/app/TerminalAlgorithm.tsx');
    const tables = read('apps/desktop/src/renderer/app/TerminalDataTables.tsx');
    for (const source of [summary, tables]) {
      expect(source).toContain("useChannel(client, 'portfolio.current'");
      expect(source).not.toContain("useChannel(client, 'portfolio.view'");

    }
    expect(summary).toContain("useChannel(client, 'paper.portfolio'");
    expect(read('apps/desktop/src/renderer/app/TerminalActivity.tsx')).toContain("useChannel(client,'trading.activity.summary'");
    expect(tables).toContain('c.connectionId===connectionId');
    expect(summary).toContain('Connected value');
    expect(summary).toContain('Connected valuation');
    expect(summary).toContain('Paper equity');
  });

  it('uses the existing connected-exposure defaults in the unified Markets workspace', () => {
    expect(read('apps/desktop/src/renderer/app/Markets.tsx')).toContain('AdvancedMarkets');
    const source = read('apps/desktop/src/renderer/app/AdvancedMarkets.tsx');
    expect(source).toContain("useChannel(client, 'portfolio.current'");
    expect(source).toContain("item.exposureKey !== 'USD'");
    expect(source).toContain('Number(item.quantity) > 0');
    expect(source).toContain('>Portfolio</option>');
  });

  it('labels imported tax lots as accounting instead of current connected balances', () => {
    const portfolio = read('apps/desktop/src/renderer/app/Portfolio.tsx');
    expect(portfolio).toContain('Portfolio accounting');
    expect(portfolio).toContain('IMPORTED ACCOUNTING VALUE');
  });
});
