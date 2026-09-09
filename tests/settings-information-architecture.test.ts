import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const settings = readFileSync(resolve('apps/desktop/src/renderer/app/Settings.tsx'), 'utf8');
const connections = readFileSync(resolve('apps/desktop/src/renderer/app/ConnectionManager.tsx'), 'utf8');
const styles = readFileSync(resolve('apps/desktop/src/renderer/styles/features.css'), 'utf8');

describe('settings information architecture', () => {
  it('organizes configuration into the required task categories with Connections first', () => {
    const connectionsIndex = settings.indexOf("id: 'connections'");
    expect(connectionsIndex).toBeGreaterThan(-1);
    for (const id of ['appearance', 'workspace', 'paper', 'advisor', 'diagnostics']) expect(settings.indexOf(`id: '${id}'`)).toBeGreaterThan(connectionsIndex);
    expect(settings).toContain("useState<SettingsCategory>('connections')");
  });

  it('uses an accessible keyboard-operated tab interface and a compact selector', () => {
    expect(settings).toContain('role="tablist"');
    expect(settings).toContain('role="tab"');
    expect(settings).toContain('role="tabpanel"');
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']) expect(settings).toContain(`event.key === '${key}'`);
    expect(styles).toContain('@container route (max-width: 700px)');
    expect(styles).toContain('.settings-category-select { display: grid; }');
  });

  it('keeps secondary connection evidence behind details', () => {
    expect(connections).toContain('<details className="settings-details"><summary>Connection details</summary>');
    expect(connections).toContain('connection-card-heading');
  });
});
