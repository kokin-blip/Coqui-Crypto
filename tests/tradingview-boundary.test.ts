import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE_FILES = globSync(['apps/**/*.{ts,tsx,html}', 'packages/**/*.{ts,tsx}'], {
  exclude: ['**/dist/**', '**/node_modules/**'],
});

describe('TradingView and live-market architecture boundary', () => {
  it('contains no TradingView remote runtime or data endpoint in production source', () => {
    for (const file of SOURCE_FILES) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/(?:s3\.)?tradingview\.com|TradingView\.widget|tv\.js/u);
    }
  });

  it('keeps the live quote service outside research, risk, execution, and storage', () => {
    const source = readFileSync('apps/desktop/src/main/coinbase-market-stream.ts', 'utf8');
    expect(source).not.toMatch(/PaperExecution|risk\/|research\/|@coqui\/storage/u);
    expect(source).toContain('decisionEligible: false');
    expect(source).toContain('informationalOnly: true');
  });
});
