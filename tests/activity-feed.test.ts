import { describe, expect, it } from 'vitest';

import { listActivityFeed, openDatabase } from '../packages/storage/src/index.js';

describe('bounded activity feed', () => {
  it('merges sources newest-first, paginates by cursor, and isolates profiles', () => {
    const database = openDatabase(':memory:');
    database.prepare(`
      INSERT INTO wallet_decision_runs
      (id, profile_id, scheduled_for, strategy_version, snapshot_hash, snapshot_json, status, created_at, updated_at, error)
      VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, NULL)
    `).run('decision-1', 'main', 100, 'trendvol-unvalidated', 'a'.repeat(64), 'completed', 100, 100);
    database.prepare(`
      INSERT INTO runtime_incidents
      (id, profile_id, run_id, kind, severity, source, detail_json, occurred_at, resolved_at, resolution)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL)
    `).run('incident-1', 'main', 'scheduler_failure', 'blocking', 'scheduler', '{"secret":"not-forwarded"}', 200);
    database.prepare(`
      INSERT INTO runtime_incidents
      (id, profile_id, run_id, kind, severity, source, detail_json, occurred_at, resolved_at, resolution)
      VALUES (?, ?, NULL, ?, ?, ?, '{}', ?, NULL, NULL)
    `).run('incident-other', 'other', 'worker_failure', 'warning', 'worker', 300);

    const first = listActivityFeed('main', 1, null, database);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({ id: 'incident:incident-1', occurredAt: 200 });
    expect(first.events[0]?.detail).not.toContain('not-forwarded');
    expect(first.nextCursor).not.toBeNull();

    const second = listActivityFeed('main', 1, first.nextCursor, database);
    expect(second.events).toEqual([expect.objectContaining({ id: 'decision:decision-1' })]);
    expect(second.events.some((event) => event.id.includes('other'))).toBe(false);
    database.close();
  });
});
