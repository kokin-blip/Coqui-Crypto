import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(path), 'utf8');

describe('mockup-fidelity advanced workspace', () => {
  it('locks the selected dark workstation palette and compact geometry', () => {
    const theme = read('packages/ui-kit/src/theme.css');
    const shell = read('apps/desktop/src/renderer/styles/shell.css');
    const workstation = read('apps/desktop/src/renderer/styles/workstation.css');

    for (const token of ['#020b08', '#04110c', '#06150f', '#091d15', '#17382b', '#2ee98b', '#8fa59a']) {
      expect(theme).toContain(token);
    }
    expect(shell).toContain('grid-template-columns: 164px minmax(0, 1fr)');
    expect(workstation).toContain('grid-template-columns: minmax(520px, 58fr) minmax(235px, 18fr) minmax(270px, 24fr)');
    expect(workstation).toContain('.panel-empty-body');
    expect(workstation).toContain('.screen-heading-integrated');
    expect(workstation).toContain('.route-local-tabs');
  });

  it('uses the owner-selected identity and keeps operational status in the required order', () => {
    const sidebar = read('apps/desktop/src/renderer/app/Sidebar.tsx');
    const rail = read('apps/desktop/src/renderer/app/StatusRail.tsx');
    const readyRail = rail.slice(rail.lastIndexOf('<div className="status-primary">'));

    expect(sidebar).toContain('<span><strong>coqui</strong></span>');
    expect(sidebar).not.toContain('research workstation</small>');
    expect(sidebar).not.toContain('sidebar-sub-list');
    expect(readyRail.indexOf('<Freshness client={client} />')).toBeLessThan(readyRail.indexOf('Safety'));
    expect(readyRail.indexOf('Safety')).toBeLessThan(readyRail.indexOf('System status'));
    for (const text of ['reconciliationText', 'active /', 'cost model', 'risk stage']) expect(readyRail).toContain(text);
  });

  it('runs clipping detection before every visual-review capture', () => {
    const review = read('apps/desktop/scripts/visual-review.mjs');
    const audit = read('apps/desktop/scripts/visual-overflow-audit.mjs');
    expect(review.indexOf('assertNoTextClipping')).toBeLessThan(review.indexOf('capturePage()'));
    expect(audit).toContain('.panel-empty-body p');
    expect(audit).toContain('[data-status-indicator]');
    expect(audit).toContain('element.scrollHeight');
    expect(audit).toContain("['hidden', 'clip']");
  });

  it('contains validation markers in reusable padded status structures', () => {
    const detail = read('apps/desktop/src/renderer/app/OverviewStrategyWorkspace.tsx');
    const indicator = read('apps/desktop/src/renderer/app/StatusIndicator.tsx');
    expect(detail).toContain('<header><div><p className="eyebrow">Strategy detail</p>');
    expect(detail).toContain('<ValidationState /></header>');
    expect(indicator).toContain('data-status-indicator');
    expect(indicator).toContain('<span>{label}</span>');
  });

  it('contains modal focus, stale-analysis, forced-color, and constrained-layout safeguards', () => {
    const advisor = read('apps/desktop/src/renderer/app/AdvisorSheet.tsx');
    const extensions = read('apps/desktop/src/renderer/app/ChartExtensionManager.tsx');
    const focus = read('apps/desktop/src/renderer/app/use-dialog-focus.ts');
    const workstation = read('apps/desktop/src/renderer/styles/workstation.css');
    expect(advisor).toContain('data-stale={answerIsStale || undefined}');
    expect(advisor).toContain('useDialogFocus(dialogRef, onClose)');
    expect(advisor).toContain('createPortal(');
    expect(extensions).toContain('createPortal(');
    expect(extensions).toContain('Choose .coquichart package');
    expect(extensions).toContain('Advanced: paste canonical package JSON');
    expect(focus).toContain("event.key === 'Escape'");
    expect(focus).toContain("event.key !== 'Tab'");
    expect(workstation).toContain('@media (forced-colors: active)');
    expect(workstation).toContain('overflow-x: hidden; overflow-y: auto');
  });
});
