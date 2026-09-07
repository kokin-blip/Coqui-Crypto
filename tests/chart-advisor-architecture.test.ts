import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
function source(path: string): string { return readFileSync(join(ROOT, path), 'utf8'); }
const RENDERER = [
  'apps/desktop/src/renderer/app/AdvancedMarkets.tsx',
  'apps/desktop/src/renderer/app/TradingWorkstationChart.tsx',
  'apps/desktop/src/renderer/app/AdvisorSheet.tsx',
  'apps/desktop/src/renderer/app/ChartExtensionManager.tsx',
  'apps/desktop/src/renderer/app/use-comparison-series.ts',
  'apps/desktop/src/renderer/app/ChartDrawingManager.tsx',
  'apps/desktop/src/renderer/app/use-dialog-focus.ts',
  'apps/desktop/src/renderer/app/chart-lifecycle.ts',
];

describe('chart, extension, and advisor authority boundaries', () => {
  it('keeps the renderer network-inert and outside service/storage authority', () => {
    for (const path of RENDERER) {
      const value = source(path);
      expect(value).not.toMatch(/\bfetch\s*\(|\bWebSocket\b|@coqui\/(?:services|storage|adapters)/u);
      expect(value).not.toMatch(/setInterval|<iframe|<script/iu);
    }
    const security = source('apps/desktop/src/main/security.ts');
    expect(security).toContain("connect-src 'none'");
    expect(security).toContain("frame-src 'none'");
  });

  it('keeps display extensions and analyst output away from financial authority', () => {
    const extension = source('packages/services/src/chart-extensions/service.ts');
    const advisor = source('packages/services/src/advisor/analyst.ts');
    for (const value of [extension, advisor]) {
      expect(value).not.toMatch(/PaperExecutionService|PaperOms|runExecutionGates|ApprovedExecution|saveResearch|risk\.dashboard/u);
    }
    expect(extension).not.toMatch(/eval\(|new Function|child_process|WASI/u);
  });

  it('contains no TradingView host, Pine import, widget, or Advanced Charts code', () => {
    const combined = RENDERER.map(source).join('\n');
    expect(combined).not.toMatch(/tradingview\.com|tv\.js|Pine Script|Advanced Charts|TradingView\.widget/iu);
    expect(combined).toContain('lightweight-charts');
  });

  it('gives one shared lifecycle ownership of chart creation and reduced motion', () => {
    const lifecycle = source('apps/desktop/src/renderer/app/chart-lifecycle.ts');
    expect(lifecycle).toContain('createChart(container');
    expect(lifecycle).toContain('prefers-reduced-motion: reduce');
    expect(lifecycle).toContain('ResizeObserver');
    expect(lifecycle).toContain('syncSeriesData');
    for (const path of ['apps/desktop/src/renderer/app/FinancialChart.tsx',
      'apps/desktop/src/renderer/app/MarketHistoryChart.tsx',
      'apps/desktop/src/renderer/app/TradingWorkstationChart.tsx']) {
      const chart = source(path);
      expect(chart).toContain('createChartLifecycle');
      expect(chart).not.toMatch(/\bcreateChart\s*\(/u);
      expect(chart).not.toContain('new ResizeObserver');
    }
  });
});
