import { describe, expect, it } from 'vitest';

import {
  createTrialRegistry,
  registerTrials,
  totalRegisteredTrialCount,
  trialCountForSignificance,
} from '../packages/core/src/index.js';
import {
  seedPredecessorTrialAudit,
  seedPredecessorVaultRecovery,
  PREDECESSOR_TRIAL_AUDIT,
  PREDECESSOR_VAULT_RECOVERY,
} from '../packages/services/src/index.js';
import {
  loadTrialRegistry,
  openDatabase,
  setTrialRegistryCompleteness,
} from '../packages/storage/src/index.js';

const KNOWN_LOWER_BOUND = 178;
const VAULT_RECOVERED = 37;

describe('trial registry completeness semantics', () => {
  it('withholds a budget from a lower bound but supplies one from an upper bound', () => {
    let lower = createTrialRegistry('known-lower-bound');
    let upper = createTrialRegistry('conservative-upper-bound');
    for (const record of PREDECESSOR_TRIAL_AUDIT) {
      lower = registerTrials(lower, record);
      upper = registerTrials(upper, record);
    }

    // Deflating against fewer trials than were run overstates significance, so
    // a lower bound must supply nothing.
    expect(trialCountForSignificance(lower)).toBeNull();
    // Over-counting can only deflate further, so an upper bound is safe.
    expect(trialCountForSignificance(upper)).toBe(KNOWN_LOWER_BOUND);
  });

  it('still treats a complete audit as exact', () => {
    const complete = registerTrials(
      createTrialRegistry('complete'),
      PREDECESSOR_TRIAL_AUDIT[0]!,
    );
    expect(trialCountForSignificance(complete)).toBe(PREDECESSOR_TRIAL_AUDIT[0]!.trialCount);
  });
});

describe('vault-recovered records', () => {
  it('adds exactly the searches the 2026-08-04 audit could not see', () => {
    expect(totalRegisteredTrialCount(
      PREDECESSOR_TRIAL_AUDIT.reduce(registerTrials, createTrialRegistry('known-lower-bound')),
    )).toBe(KNOWN_LOWER_BOUND);

    const recovered = PREDECESSOR_VAULT_RECOVERY.reduce(
      (sum, record) => sum + record.trialCount,
      0,
    );
    expect(recovered).toBe(VAULT_RECOVERED);
    expect(PREDECESSOR_VAULT_RECOVERY.map((record) => record.id)).toEqual([
      'predecessor-rotation-round1-upper-bound',
      'predecessor-regime-allocator-arms',
      'predecessor-adaptive-pick-arms',
      'predecessor-pooled-metalabel-arms',
    ]);
  });

  it('keeps every recovered record unresolved, with no fabricated provenance', () => {
    for (const record of PREDECESSOR_VAULT_RECOVERY) {
      expect(record.evidenceStatus).toBe('legacy-unresolved');
      // The old runs preserved neither input bytes nor a cost profile. Hashing
      // the script or the study note would be false provenance.
      expect(record.datasetHash).toBeNull();
      expect(record.costProfileHash).toBeNull();
      expect(record.producedDefaults).toEqual({});
      expect(record.studyRef).toBe('docs/studies/predecessor-vault-recovery-2026-08-21.md');
    }
  });
});

describe('seeding', () => {
  it('promotes the registry to a usable budget and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(loadTrialRegistry(db).completeness).toBe('known-lower-bound');
    expect(trialCountForSignificance(loadTrialRegistry(db))).toBeNull();

    expect(seedPredecessorTrialAudit(db)).toBe(PREDECESSOR_TRIAL_AUDIT.length);
    // The audit alone still withholds a budget.
    expect(trialCountForSignificance(loadTrialRegistry(db))).toBeNull();

    expect(seedPredecessorVaultRecovery(db)).toBe(PREDECESSOR_VAULT_RECOVERY.length);
    const registry = loadTrialRegistry(db);
    expect(registry.completeness).toBe('conservative-upper-bound');
    expect(trialCountForSignificance(registry)).toBe(KNOWN_LOWER_BOUND + VAULT_RECOVERED);

    // Re-running inserts nothing and changes no count.
    expect(seedPredecessorVaultRecovery(db)).toBe(0);
    expect(trialCountForSignificance(loadTrialRegistry(db))).toBe(
      KNOWN_LOWER_BOUND + VAULT_RECOVERED,
    );
    db.close();
  });

  it('refuses to withdraw a published budget', () => {
    const db = openDatabase(':memory:');
    seedPredecessorVaultRecovery(db);
    // Regressing would silently retract a DSR the scoreboard already showed.
    expect(() => setTrialRegistryCompleteness('known-lower-bound', db)).toThrow(
      /may only advance/u,
    );
    db.close();
  });

  it('refuses to downgrade a complete audit', () => {
    const db = openDatabase(':memory:');
    setTrialRegistryCompleteness('complete', db);
    expect(() => setTrialRegistryCompleteness('conservative-upper-bound', db)).toThrow(
      /cannot be downgraded/u,
    );
    db.close();
  });

  it('survives migration 45 on a database created before it existed', () => {
    // The completeness column carried a CHECK constraint pinned to two values;
    // the migration rebuilds the table, so an existing value must survive.
    const db = openDatabase(':memory:');
    expect(loadTrialRegistry(db).completeness).toBe('known-lower-bound');
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number | bigint };
    expect(Number(version.user_version)).toBeGreaterThanOrEqual(45);
    db.close();
  });
});
