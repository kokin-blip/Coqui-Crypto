import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('crew robot presentation', () => {
  it('provides a distinct accessory for each operations role and varied research workers', () => {
    const source = readFileSync(join(process.cwd(), 'apps/desktop/src/renderer/app/CrewRobot.tsx'), 'utf8');
    for (const role of ['host', 'market', 'research', 'risk', 'execution', 'advisor']) {
      expect(source).toContain(`role === '${role}'`);
    }
    expect(source).toContain('variant % 3');
  });

  it('has bounded status motion with reduced-motion fallbacks', () => {
    const source = readFileSync(join(process.cwd(), 'apps/desktop/src/renderer/styles/features.css'), 'utf8');
    expect(source).toContain("[data-state='active']");
    expect(source).toContain("[data-state='unavailable']");
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain(":root[data-motion='none'] .crew-robot");
  });
});
