import { describe, expect, it } from 'vitest';

import { FixedClock } from '../packages/core/src/index.js';
import { StatusRailService } from '../packages/services/src/index.js';
import {
  ensureWalletUtcSchedule,
  openDatabase,
  saveWalletRiskState,
  setSetting,
  type Db,
} from '../packages/storage/src/index.js';

const NOW = 1_724_000_000_000;
const PROFILE = 'main';

function service(db: Db, nowMs = NOW): StatusRailService {
  return new StatusRailService({ database: db, clock: new FixedClock(nowMs) });
}

function riskState(overrides: Partial<Parameters<typeof saveWalletRiskState>[0]> = {}) {
  return {
    profileId: PROFILE,
    stage: 'stage_2',
    dailyPeakUsd: null,
    rollingPeakUsd: null,
    lifetimePeakUsd: null,
    hardStopped: false,
    reason: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('StatusRailService', () => {
  it('reports paper mode and permitted execution on a clean profile', () => {
    const db = openDatabase(':memory:');
    const result = service(db).status(PROFILE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Invariant 1: paper is the only executable mode in this build.
    expect(result.value.mode).toBe('paper');
    expect(result.value.executionPermitted).toBe(true);
    expect(result.value.killSwitchEngaged).toBe(false);
    expect(result.value.costModelBps).toBeGreaterThan(0);
    db.close();
  });

  it('reports the kill switch and withdraws execution permission with it', () => {
    const db = openDatabase(':memory:');
    saveWalletRiskState(riskState({ hardStopped: true, reason: 'drawdown' }), db);

    const result = service(db).status(PROFILE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.killSwitchEngaged).toBe(true);
    // canExecute must agree; the rail never shows an engaged kill switch
    // alongside permitted execution.
    expect(result.value.executionPermitted).toBe(false);
    expect(result.value.riskStage).toBe('stage_2');
    db.close();
  });
});

describe('StatusRailService reconciliation slot', () => {
  it('distinguishes never-run from settled', () => {
    const db = openDatabase(':memory:');

    const never = service(db).status(PROFILE);
    expect(never.ok && never.value.reconciliation).toEqual({
      lastRunAtMs: null,
      unresolvedCount: 0,
      neverRun: true,
    });

    setSetting('coinbase.last_sync_at', String(NOW - 3_600_000), db);
    const settled = service(db).status(PROFILE);
    expect(settled.ok && settled.value.reconciliation).toEqual({
      lastRunAtMs: NOW - 3_600_000,
      unresolvedCount: 0,
      neverRun: false,
    });
    db.close();
  });

  it('ignores a malformed stored timestamp rather than rendering an epoch', () => {
    const db = openDatabase(':memory:');
    setSetting('coinbase.last_sync_at', 'not-a-number', db);

    const result = service(db).status(PROFILE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A NaN here would render as 1970 in the rail, which reads as a real run.
    expect(result.value.reconciliation.lastRunAtMs).toBeNull();
    expect(result.value.reconciliation.neverRun).toBe(true);
    db.close();
  });
});

describe('StatusRailService job counting', () => {
  it('does not count an expired lease as a running job', () => {
    const db = openDatabase(':memory:');
    // A crashed worker leaves state 'running' with a lease in the past.
    // Counting by owner alone would report it as still working.
    // nextRunAt must be UTC-aligned to the cadence.
    const dayAligned = Math.floor(NOW / 86_400_000) * 86_400_000;
    ensureWalletUtcSchedule(PROFILE, 86_400_000, 0, dayAligned, db);

    const result = service(db).status(PROFILE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activeJobCount).toBe(0);
    expect(result.value.scheduledJobCount).toBe(1);
    db.close();
  });
});

describe('StatusRailService failure modes', () => {
  it('rejects a malformed profile id before touching storage', () => {
    const db = openDatabase(':memory:');
    const svc = service(db);
    for (const bad of ['', '../../etc/passwd', 'DROP TABLE', 'not-a-uuid']) {
      expect(svc.status(bad)).toEqual({
        ok: false,
        issues: [{ path: ['statusRail', 'profileId'], code: 'invalid_profile_id' }],
      });
    }
    db.close();
  });

  it('fails closed on an unusable clock', () => {
    const db = openDatabase(':memory:');
    const broken = new StatusRailService({
      database: db,
      clock: {
        nowMs() {
          throw new Error('no clock');
        },
      },
    });
    expect(broken.status(PROFILE)).toEqual({
      ok: false,
      issues: [{ path: ['statusRail'], code: 'clock_unavailable' }],
    });
    db.close();
  });

  it('reports a storage failure with a stable code and no message', () => {
    const db = openDatabase(':memory:');
    db.exec('DROP TABLE wallet_risk_state_v2');

    const result = service(db).status(PROFILE);
    expect(result).toEqual({
      ok: false,
      issues: [{ path: ['statusRail'], code: 'storage_rejected' }],
    });
    expect(JSON.stringify(result)).not.toContain('wallet_risk_state_v2');
    db.close();
  });
});
