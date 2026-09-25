import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(path), 'utf8');

describe('workspace hierarchy and recovery', () => {
  it('places the decision before portfolio and strategy detail on Overview', () => {
    const overview = read('apps/desktop/src/renderer/app/Overview.tsx');
    const simple = overview.slice(overview.indexOf("workspace.mode === 'simple'"));
    expect(simple.indexOf('{decision}{health}{chartPanel}{connectedReference}')).toBeGreaterThanOrEqual(0);
    const advanced = overview.slice(overview.indexOf('return <OverviewStrategyProvider'));
    expect(advanced.indexOf('{decision}')).toBeLessThan(advanced.indexOf('{panels.healthStrip && health}'));
    expect(advanced.indexOf('{panels.healthStrip && health}')).toBeLessThan(advanced.indexOf('research-grid-primary'));
  });

  it('gives missing portfolio evidence a truthful next action', () => {
    const allocation = read('apps/desktop/src/renderer/app/AllocationRingChart.tsx');
    const performance = read('apps/desktop/src/renderer/app/HeldCoinPerformance.tsx');
    const accounting = read('apps/desktop/src/renderer/app/Portfolio.tsx');
    expect(allocation).toContain('Open connections');
    expect(performance).toContain('Open Markets');
    expect(accounting).toContain('View connected portfolio');
  });

  it('groups Advisor configuration and history behind progressive disclosure', () => {
    const advisor = read('apps/desktop/src/renderer/app/AdvisorSheet.tsx');
    expect(advisor).toContain('<summary>Context and destinations</summary>');
    expect(advisor).toContain('<summary>Provider and response</summary>');
    expect(advisor).toContain('Saved conversations ·');
  });

  it('uses route containers for research, portfolio, risk, and overview reflow', () => {
    const css = read('apps/desktop/src/renderer/styles/workstation.css');
    expect(css).toContain('@container route (max-width: 1100px)');
    expect(css).toContain('.research-grid-primary');
    expect(css).toContain('.portfolio-master-detail');
    expect(css).toContain('.risk-meter-grid');
    expect(css).toContain('.overview-health');
  });
});
