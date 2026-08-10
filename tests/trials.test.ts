import { describe, expect, it } from 'vitest';
import {
  createTrialRegistry,
  registerTrials,
  registeredTrialCount,
  requireRegisteredTrials,
  type TrialRecord,
} from '../packages/core/src/index.js';

const datasetHash = 'a'.repeat(64);

function record(overrides: Partial<TrialRecord> = {}): TrialRecord {
  return {
    id: 'momentum-grid-2026-08-01',
    family: 'momentum',
    searchKind: 'grid',
    evidenceStatus: 'verified',
    parameterSpace: { lookbackDays: [90, 180], targetVolPct: [50] },
    trialCount: 2,
    searchedAt: '2026-08-01T12:00:00.000Z',
    datasetHash,
    costProfileHash: 'b'.repeat(64),
    codeRevision: 'test-revision',
    producedDefaults: { lookbackDays: 180, targetVolPct: 50 },
    studyRef: 'docs/studies/momentum-2026-08-01.md',
    ...overrides,
  };
}

describe('TrialRegistry', () => {
  it('is append-only and does not mutate the prior snapshot', () => {
    const empty = createTrialRegistry();
    const next = registerTrials(empty, record());
    expect(empty.records).toHaveLength(0);
    expect(next.records).toHaveLength(1);
    expect(() => registerTrials(next, record())).toThrow(/already exists/);
  });

  it('counts every search kind for the family', () => {
    const first = registerTrials(createTrialRegistry(), record());
    const second = registerTrials(
      first,
      record({
        id: 'momentum-human-2026-08-01',
        searchKind: 'human-guided',
        trialCount: 7,
      }),
    );
    const third = registerTrials(
      second,
      record({
        id: 'momentum-feature-screen-2026-08-01',
        searchKind: 'feature-screen',
        trialCount: 11,
      }),
    );
    expect(registeredTrialCount(third, 'momentum')).toBe(20);
  });

  it('refuses an unregistered family at the significance boundary', () => {
    expect(() => requireRegisteredTrials(createTrialRegistry(), 'trendvol')).toThrow(/No registered trials/);
  });

  it('rejects invalid counts, hashes, timestamps, and study references', () => {
    expect(() => registerTrials(createTrialRegistry(), record({ trialCount: 0 }))).toThrow(RangeError);
    expect(() => registerTrials(createTrialRegistry(), record({ datasetHash: 'not-a-hash' }))).toThrow(TypeError);
    expect(() => registerTrials(createTrialRegistry(), record({ searchedAt: '2026-08-01' }))).toThrow(TypeError);
    expect(() => registerTrials(createTrialRegistry(), record({ studyRef: 'notes/result.md' }))).toThrow(TypeError);
  });

  it('counts unresolved historical searches but does not call them verified', async () => {
    const { trialRegistryHash, verifiedTrialCount } = await import('../packages/core/src/index.js');
    const registry = registerTrials(createTrialRegistry(), record({
      evidenceStatus: 'legacy-unresolved', datasetHash: null, costProfileHash: null,
    }));
    expect(registeredTrialCount(registry, 'momentum')).toBe(2);
    expect(verifiedTrialCount(registry, 'momentum')).toBe(0);
    expect(trialRegistryHash(registry)).toMatch(/^[a-f0-9]{64}$/u);
  });
});
