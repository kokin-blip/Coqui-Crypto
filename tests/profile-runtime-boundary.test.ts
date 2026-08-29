import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CHANNEL_SCHEMAS } from '../packages/contracts/src/index.js';

const ROOT = process.cwd();

describe('active profile is a main-process boundary', () => {
  it('rejects renderer-supplied profile ids on profile-scoped channels', () => {
    for (const channel of [
      'accounts.settings', 'accounts.workspace', 'app.status-rail', 'alerts.view', 'portfolio.reconciliation',
      'paper.portfolio', 'paper.performance',
    ] as const) {
      expect(CHANNEL_SCHEMAS[channel].request.safeParse({ profileId: 'main' }).success).toBe(false);
    }
  });

  it('resets profile-scoped query data before the confirmed switch can paint', () => {
    const source = readFileSync(join(ROOT, 'apps/desktop/src/renderer/app/ProfileSwitcher.tsx'), 'utf8');
    expect(source).toContain('useLayoutEffect');
    expect(source).toContain('queryClient.resetQueries');
    expect(source).toContain("query.queryKey[0] !== 'accounts.profile.switch'");
  });

  it('does not rewrite the current hash route during a profile switch', () => {
    const source = readFileSync(join(ROOT, 'apps/desktop/src/renderer/app/ProfileSwitcher.tsx'), 'utf8');
    expect(source).not.toMatch(/location\.(?:hash|assign|replace)/u);
    expect(source).not.toContain('navigate(');
  });

  it('starts a prepared scheduler before swapping away from the active runtime', () => {
    const source = readFileSync(join(ROOT, 'apps/desktop/src/main/profile-runtime.ts'), 'utf8');
    expect(source.indexOf('candidate.startScheduler()')).toBeLessThan(source.indexOf('current = candidate'));
    expect(source).toMatch(/catch \{\s+candidate\.dispose\(\);\s+return \{ ok: false \};/u);
  });
});
