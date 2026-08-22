import { describe, expect, it } from 'vitest';

import {
  FixedClock,
  MIN_FORWARD_PAPER_DAYS,
  MIN_FORWARD_PAPER_DECISIONS,
  MIN_FORWARD_PAPER_FILLS,
} from '../packages/core/src/index.js';
import { forwardPaperEvidence } from '../packages/services/src/index.js';
import {
  listWalletRunAuditsByRun,
  openDatabase,
  saveWalletDecisionRun,
  appendWalletRunAudit,
  type Db,
} from '../packages/storage/src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const PROFILE = 'main';

function decisionRun(db: Db, slot: number, status: 'completed' | 'failed' = 'completed'): void {
  saveWalletDecisionRun(
    {
      id: `run-${slot}`,
      profileId: PROFILE,
      scheduledFor: slot,
      strategyVersion: 'v1',
      snapshotHash: 'h'.repeat(64),
      snapshotJson: '{}',
      status,
      createdAt: slot,
      updatedAt: slot,
      error: null,
    },
    db,
  );
}

describe('forward evidence counts engine activity, not elapsed time', () => {
  it('reports zero on a profile that has never run', () => {
    const db = openDatabase(':memory:');
    const view = forwardPaperEvidence({ database: db, clock: new FixedClock(T0) }, PROFILE);

    expect(view.evidence).toEqual({ days: 0, decisions: 0, fills: 0 });
    expect(view.allRequirementsMet).toBe(false);
    db.close();
  });

  it('counts a stand-down day as observed', () => {
    const db = openDatabase(':memory:');
    // The engine ran and decided to do nothing. It observed the market, so the
    // day counts — unlike a day the app was closed, which contributes nothing.
    decisionRun(db, T0 + DAY);
    const view = forwardPaperEvidence({ database: db, clock: new FixedClock(T0 + 2 * DAY) }, PROFILE);

    expect(view.evidence.days).toBe(1);
    expect(view.evidence.decisions).toBe(1);
    expect(view.evidence.fills).toBe(0);
    db.close();
  });

  it('does not count a failed run', () => {
    const db = openDatabase(':memory:');
    decisionRun(db, T0 + DAY, 'failed');
    const view = forwardPaperEvidence({ database: db, clock: new FixedClock(T0 + 2 * DAY) }, PROFILE);
    expect(view.evidence.days).toBe(0);
    db.close();
  });

  it('counts distinct slots, so a re-fired slot does not inflate the evidence', () => {
    const db = openDatabase(':memory:');
    for (let day = 1; day <= 5; day += 1) decisionRun(db, T0 + day * DAY);
    // Same slot again under the same id — an upsert, not a new day.
    decisionRun(db, T0 + DAY);

    const view = forwardPaperEvidence({ database: db, clock: new FixedClock(T0 + 9 * DAY) }, PROFILE);
    expect(view.evidence.days).toBe(5);
    db.close();
  });

  it('is scoped per profile', () => {
    const db = openDatabase(':memory:');
    decisionRun(db, T0 + DAY);
    const other = forwardPaperEvidence({ database: db, clock: new FixedClock(T0) }, 'elsewhere');
    expect(other.evidence.days).toBe(0);
    db.close();
  });
});

describe('the gate it feeds', () => {
  it('states the thresholds core already defines rather than new ones', () => {
    const db = openDatabase(':memory:');
    const view = forwardPaperEvidence({ database: db, clock: new FixedClock(T0) }, PROFILE);

    expect(view.requirements.map((entry) => entry.required)).toEqual([
      MIN_FORWARD_PAPER_DAYS,
      MIN_FORWARD_PAPER_DECISIONS,
      MIN_FORWARD_PAPER_FILLS,
    ]);
    expect(view.requirements.map((entry) => entry.code)).toEqual([
      'observed_days',
      'decisions',
      'fills',
    ]);
    db.close();
  });

  it('never permits live execution, whatever the counts', () => {
    const db = openDatabase(':memory:');
    for (let day = 1; day <= 120; day += 1) decisionRun(db, T0 + day * DAY);

    const view = forwardPaperEvidence({ database: db, clock: new FixedClock(T0 + 200 * DAY) }, PROFILE);
    expect(view.evidence.days).toBe(120);
    // Meeting the bar makes live considerable, never enabled — there is no
    // order-submission path in this build at all.
    expect(view.liveExecutionPermitted).toBe(false);
    db.close();
  });
});

describe('per-run journal replay', () => {
  it('returns one run in the order it happened', () => {
    const db = openDatabase(':memory:');
    for (const [index, kind] of ['paper_run', 'gates', 'orders'].entries()) {
      appendWalletRunAudit(
        {
          id: `a-${index}`,
          profileId: PROFILE,
          runId: 'run-1',
          at: T0 + index,
          kind,
          status: 'ok',
          detailJson: '{}',
        },
        db,
      );
    }
    appendWalletRunAudit(
      { id: 'other', profileId: PROFILE, runId: 'run-2', at: T0, kind: 'paper_run', status: 'ok', detailJson: '{}' },
      db,
    );

    // listWalletRunAudits orders newest-first by profile, which suits a
    // dashboard but not replaying a single run.
    const replay = listWalletRunAuditsByRun('run-1', 50, db);
    expect(replay.map((audit) => audit.kind)).toEqual(['paper_run', 'gates', 'orders']);
    db.close();
  });
});
