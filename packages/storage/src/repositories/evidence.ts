import type { EvidenceSnapshot } from '@coqui/core';

import type { Db } from '../sqlite/index.js';

export function saveEvidenceSnapshot(snapshot: EvidenceSnapshot, database: Db): void {
  database.prepare(`
    INSERT INTO evidence_snapshots (
      day_ms, leader, dsr, psr, sig_verdict, wf_verdict, leader_sortino,
      hold_sortino, passive_sortino, sample_days
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day_ms) DO UPDATE SET
      leader = excluded.leader,
      dsr = excluded.dsr,
      psr = excluded.psr,
      sig_verdict = excluded.sig_verdict,
      wf_verdict = excluded.wf_verdict,
      leader_sortino = excluded.leader_sortino,
      hold_sortino = excluded.hold_sortino,
      passive_sortino = excluded.passive_sortino,
      sample_days = excluded.sample_days
  `).run(
    snapshot.dayMs,
    snapshot.leader,
    snapshot.dsr,
    snapshot.psr,
    snapshot.sigVerdict,
    snapshot.wfVerdict,
    snapshot.leaderSortino,
    snapshot.holdSortino,
    snapshot.passiveSortino,
    snapshot.sampleDays,
  );
}

export function listEvidenceSnapshots(database: Db, sinceMs?: number): EvidenceSnapshot[] {
  const rows = (sinceMs === undefined
    ? database.prepare('SELECT * FROM evidence_snapshots ORDER BY day_ms').all()
    : database.prepare(
      'SELECT * FROM evidence_snapshots WHERE day_ms >= ? ORDER BY day_ms',
    ).all(sinceMs)) as unknown as Array<{
      day_ms: number;
      leader: string;
      dsr: number | null;
      psr: number | null;
      sig_verdict: EvidenceSnapshot['sigVerdict'];
      wf_verdict: EvidenceSnapshot['wfVerdict'];
      leader_sortino: number | null;
      hold_sortino: number | null;
      passive_sortino: number | null;
      sample_days: number;
    }>;
  return rows.map((row) => ({
    dayMs: row.day_ms,
    leader: row.leader,
    dsr: row.dsr,
    psr: row.psr,
    sigVerdict: row.sig_verdict,
    wfVerdict: row.wf_verdict,
    leaderSortino: row.leader_sortino,
    holdSortino: row.hold_sortino,
    passiveSortino: row.passive_sortino,
    sampleDays: row.sample_days,
  }));
}
