import { describe, expect, it } from 'vitest';

import {
  acquireExecutionLease,
  getExecutionLease,
  openDatabase,
  releaseExecutionLease,
  renewExecutionLease,
  validateExecutionLease,
} from '../packages/storage/src/index.js';

describe('fenced execution authority', () => {
  it('excludes a second owner and permanently rejects stale fencing tokens', () => {
    const database = openDatabase(':memory:');
    const first = acquireExecutionLease('profile-a', 'desktop-a', 100, 50, database)!;
    expect(first.fencingToken).toBe(1);
    expect(acquireExecutionLease('profile-a', 'desktop-b', 101, 50, database)).toBeNull();
    expect(validateExecutionLease('profile-a', 'desktop-a', 1, 120, database)).toBe(true);
    expect(renewExecutionLease('profile-a', 'desktop-a', 1, 120, 50, database)).toBe(true);

    const takeover = acquireExecutionLease('profile-a', 'desktop-b', 171, 50, database)!;
    expect(takeover.fencingToken).toBe(2);
    expect(validateExecutionLease('profile-a', 'desktop-a', 1, 171, database)).toBe(false);
    expect(renewExecutionLease('profile-a', 'desktop-a', 1, 171, 50, database)).toBe(false);
    expect(releaseExecutionLease('profile-a', 'desktop-a', 1, 171, database)).toBe(false);
    expect(releaseExecutionLease('profile-a', 'desktop-b', 2, 172, database)).toBe(true);
    expect(getExecutionLease('profile-a', database)).toMatchObject({
      ownerId: null, leasedUntilMs: null, fencingToken: 2,
    });
    expect(() => database.prepare('DELETE FROM execution_lease_events_v1').run()).toThrow();
  });
});
