import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const overview = readFileSync(resolve('apps/desktop/src/renderer/app/Overview.tsx'), 'utf8');
const chartFrame = readFileSync(resolve('apps/desktop/src/renderer/app/ChartFrame.tsx'), 'utf8');

describe('advanced overview composition', () => {
  it('composes one terminal with market panels, data tabs, and algorithm evidence', () => {
    const terminal = readFileSync(resolve('apps/desktop/src/renderer/app/TerminalWorkspace.tsx'), 'utf8');
    expect(overview).toContain('TerminalWorkspace');
    expect(terminal).toContain('<AdvancedMarkets client={client} embedded');
    expect(terminal).toContain('<TerminalOrderBook');
    expect(terminal).toContain('<TerminalAlgorithm');
    expect(terminal).toContain('<TerminalAlgorithmDrawer');
    expect(terminal).toContain('requestFullscreen()');
    expect(terminal).not.toContain('workspace.mode');
  });

  it('keeps chart inspection keyboard accessible and exposes fullscreen and snapshot controls', () => {
    expect(chartFrame).toContain("event.key !== 'ArrowLeft'");
    expect(chartFrame).toContain("event.key !== 'ArrowRight'");
    expect(chartFrame).toContain('Open full screen chart');
    expect(chartFrame).toContain('Save chart as PNG');
    expect(chartFrame).toContain('aria-live="polite"');
  });
});
