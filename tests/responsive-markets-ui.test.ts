import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(path), 'utf8');

describe('responsive Markets workspace', () => {
  it('keeps every workstation capability reachable through grouped controls', () => {
    const toolbar = read('apps/desktop/src/renderer/app/MarketWorkspaceToolbar.tsx');
    for (const label of ['Chart', 'Layout', 'Extensions', 'Save view']) expect(toolbar).toContain(label);
    const panels = read('apps/desktop/src/renderer/app/MarketPanelControls.tsx');
    for (const label of ['Draw', 'Watchlist', 'Facts']) expect(panels).toContain(label);
  });

  it('adapts from four columns to chart-first drawers by route width', () => {
    const css = read('apps/desktop/src/renderer/styles/workstation.css');
    expect(css).toContain('@container route (max-width: 1259px)');
    expect(css).toContain('@container route (max-width: 899px)');
    expect(css).toContain('.market-facts-inspector.panel-open');
    expect(css).toContain('.advanced-watchlist.panel-open');
    expect(css).toContain('.drawing-tool-rail.panel-open');
  });

  it('offers recovery instead of leaving an inert empty chart', () => {
    const markets = read('apps/desktop/src/renderer/app/AdvancedMarkets.tsx');
    expect(markets).toContain('Refresh history');
    expect(markets).toContain('Open connections');
    expect(markets).toContain("queryKey: ['market-data.display-bars']");
  });
});
