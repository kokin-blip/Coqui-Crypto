import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const overview = readFileSync(resolve('apps/desktop/src/renderer/app/Overview.tsx'), 'utf8');
const chartFrame = readFileSync(resolve('apps/desktop/src/renderer/app/ChartFrame.tsx'), 'utf8');

describe('advanced overview composition', () => {
  it('keeps portfolio health ahead of strategy detail in both workspace modes', () => {
    const simpleStart = overview.indexOf("workspace.mode === 'simple'");
    const advancedStart = overview.indexOf('research-grid-primary');
    const primary = overview.indexOf('{chartPanel}{connectedReference}<EvidenceStack');
    const secondary = overview.indexOf('research-grid-secondary');
    const health = overview.lastIndexOf('{panels.healthStrip && health}');
    const negative = overview.lastIndexOf('{panels.negativeFindings &&');

    expect(simpleStart).toBeGreaterThan(-1);
    expect(overview.slice(simpleStart, advancedStart))
      .toContain('{health}{chartPanel}{connectedReference}{decision}');
    expect(health).toBeLessThan(primary);
    expect(primary).toBeGreaterThan(advancedStart);
    expect(secondary).toBeGreaterThan(primary);
    expect(negative).toBeGreaterThan(secondary);
  });

  it('keeps chart inspection keyboard accessible and exposes fullscreen and snapshot controls', () => {
    expect(chartFrame).toContain("event.key !== 'ArrowLeft'");
    expect(chartFrame).toContain("event.key !== 'ArrowRight'");
    expect(chartFrame).toContain('Open full screen chart');
    expect(chartFrame).toContain('Save chart as PNG');
    expect(chartFrame).toContain('aria-live="polite"');
  });
});
