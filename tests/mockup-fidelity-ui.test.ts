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
  });

  it('uses the owner-selected identity and keeps operational status in the required order', () => {
    const sidebar = read('apps/desktop/src/renderer/app/Sidebar.tsx');
    const rail = read('apps/desktop/src/renderer/app/StatusRail.tsx');
    const readyRail = rail.slice(rail.lastIndexOf('<div className="status-primary">'));

    expect(sidebar).toContain('<span><strong>coqui</strong></span>');
    expect(sidebar).not.toContain('research workstation</small>');
    expect(readyRail.indexOf('<Freshness client={client} />')).toBeLessThan(readyRail.indexOf('Reconciliation'));
    expect(readyRail.indexOf('Reconciliation')).toBeLessThan(readyRail.indexOf('Risk permission'));
    for (const text of ['KILL', 'jobs', 'costs', 'risk stage']) expect(readyRail).toContain(text);
  });

  it('runs clipping detection before every visual-review capture', () => {
    const review = read('apps/desktop/scripts/visual-review.mjs');
    const audit = read('apps/desktop/scripts/visual-overflow-audit.mjs');
    expect(review.indexOf('assertNoTextClipping')).toBeLessThan(review.indexOf('capturePage()'));
    expect(audit).toContain('.panel-empty-body p');
    expect(audit).toContain('element.scrollHeight');
  });
});
