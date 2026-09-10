import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const characterNames = ['coqui', 'scout', 'darwin', 'guard', 'courier', 'advisor'] as const;

describe('operations robot crew', () => {
  it('renders all six evidence-backed subsystems with the shared robot family', () => {
    const component = readFileSync(join(process.cwd(),
      'apps/desktop/src/renderer/app/OperationsFloor.tsx'), 'utf8');
    const robot = readFileSync(join(process.cwd(),
      'apps/desktop/src/renderer/app/CrewRobot.tsx'), 'utf8');
    for (const name of characterNames) {
      expect(component.toLowerCase()).toContain(name);
    }
    expect(component).toContain('<CrewRobot');
    expect(robot).toContain('aria-hidden="true"');
    expect(robot).toContain('stableVariant');
    expect(robot).not.toMatch(/autoplay|video/iu);
  });
});
